/**
 * Repository tests — real production data-access code against the in-memory
 * Supabase double. The repositories only depend on `DbClient`, so swapping the
 * adapter in exercises exactly the code that runs in production while keeping
 * Postgres semantics (scoping, ordering, limiting, `single()` vs `maybeSingle`,
 * unique constraints) under test.
 *
 * The security-critical assertion repeated throughout is **user scoping**: a
 * query made for one user must never see, mutate, or delete another user's rows.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  createGoal,
  createTask,
  deleteTask,
  getPreferences,
  getProfile,
  globalSearch,
  listGoals,
  listNotifications,
  listTasks,
  markAllNotificationsRead,
  markNotificationRead,
  updateTask,
  upsertDailyPlan,
  upsertIntegration,
  upsertPreferences,
} from '../lib/db/repositories';
import type { Task } from '../lib/types';
import { OTHER_USER, TEST_USER, createFakeSupabase, isoDaysFromNow } from './helpers/fakeSupabase';

const db = createFakeSupabase();

beforeEach(() => {
  db.reset();
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
describe('task repository', () => {
  it('scopes every query to the calling user', async () => {
    db.seed('tasks', [
      { id: 't-mine', user_id: TEST_USER, title: 'Mine' },
      { id: 't-theirs', user_id: OTHER_USER, title: 'Theirs' },
    ]);

    const { data } = await listTasks(db.client, TEST_USER);

    expect(data?.map((task) => task.id)).toEqual(['t-mine']);
  });

  it('stamps the server-derived user_id on insert', async () => {
    // A caller must never be able to inject a different owner through `values`.
    const { data } = await createTask(db.client, TEST_USER, {
      title: 'Write brief',
      user_id: OTHER_USER,
    } as Partial<Task>);

    expect(data?.user_id).toBe(TEST_USER);
    expect(db.table('tasks')[0].user_id).toBe(TEST_USER);
  });

  it('refuses to update another user\'s task', async () => {
    db.seed('tasks', [{ id: 't-theirs', user_id: OTHER_USER, title: 'Theirs', status: 'todo' }]);

    const { data, error } = await updateTask(db.client, TEST_USER, 't-theirs', { status: 'completed' });

    expect(error?.message).toBe('Unable to update the task.');
    expect(data).toBeNull();
    expect(db.table('tasks')[0].status).toBe('todo');
  });

  it('refuses to delete another user\'s task', async () => {
    db.seed('tasks', [{ id: 't-theirs', user_id: OTHER_USER, title: 'Theirs' }]);

    await deleteTask(db.client, TEST_USER, 't-theirs');

    expect(db.table('tasks')).toHaveLength(1);
  });

  it('orders by due date with undated tasks last, then by recency', async () => {
    db.seed('tasks', [
      { id: 'undated', user_id: TEST_USER, title: 'No date', due_date: null, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'later', user_id: TEST_USER, title: 'Later', due_date: isoDaysFromNow(10), created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'sooner-old', user_id: TEST_USER, title: 'Sooner, older', due_date: isoDaysFromNow(1), created_at: '2025-01-01T00:00:00.000Z' },
      { id: 'sooner', user_id: TEST_USER, title: 'Sooner', due_date: isoDaysFromNow(1), created_at: '2026-01-01T00:00:00.000Z' },
    ]);

    const { data } = await listTasks(db.client, TEST_USER);

    // Same due date → most recently created first; nulls sort last.
    expect(data?.map((task) => task.id)).toEqual(['sooner', 'sooner-old', 'later', 'undated']);
  });

  it('filters by status, project, goal and due window', async () => {
    db.seed('tasks', [
      { id: 'a', user_id: TEST_USER, title: 'A', status: 'todo', project_id: 'p1', goal_id: 'g1', due_date: isoDaysFromNow(2) },
      { id: 'b', user_id: TEST_USER, title: 'B', status: 'completed', project_id: 'p1', goal_id: 'g1', due_date: isoDaysFromNow(2) },
      { id: 'c', user_id: TEST_USER, title: 'C', status: 'todo', project_id: 'p2', goal_id: 'g1', due_date: isoDaysFromNow(20) },
      { id: 'd', user_id: TEST_USER, title: 'D', status: 'todo', project_id: 'p1', goal_id: 'g2', due_date: isoDaysFromNow(2) },
    ]);

    expect((await listTasks(db.client, TEST_USER, { status: ['todo'] })).data?.map((t) => t.id)).toEqual(['a', 'd', 'c']);
    expect((await listTasks(db.client, TEST_USER, { projectId: 'p1' })).data?.map((t) => t.id)).toEqual(['a', 'b', 'd']);
    expect((await listTasks(db.client, TEST_USER, { goalId: 'g1' })).data?.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect((await listTasks(db.client, TEST_USER, { dueBefore: isoDaysFromNow(5) })).data?.map((t) => t.id)).toEqual(['a', 'b', 'd']);
    expect((await listTasks(db.client, TEST_USER, { dueAfter: isoDaysFromNow(5) })).data?.map((t) => t.id)).toEqual(['c']);
    expect((await listTasks(db.client, TEST_USER, { limit: 1 })).data?.map((t) => t.id)).toEqual(['a']);
  });

  it('reports a friendly error instead of a raw database message', async () => {
    db.seed('tasks', [{ id: 'dup', user_id: TEST_USER, title: 'Dup', idempotency_key: 'key-1' }]);

    const { data, error } = await createTask(db.client, TEST_USER, {
      title: 'Again',
      idempotency_key: 'key-1',
    } as Partial<Task>);

    // `describeDbError` maps 23505 onto an actionable sentence, never leaking SQL.
    expect(data).toBeNull();
    expect(error?.message).toBe('That record already exists.');
    expect(error?.code).toBe('23505');
    expect(db.table('tasks')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------
describe('goal repository', () => {
  it('hides archived goals by default and orders by position', async () => {
    db.seed('goals', [
      { id: 'g-archived', user_id: TEST_USER, title: 'Archived', status: 'archived', position: 2 },
      { id: 'g-third', user_id: TEST_USER, title: 'Third', status: 'active', position: 3 },
      { id: 'g-first', user_id: TEST_USER, title: 'First', status: 'active', position: 1 },
    ]);

    expect((await listGoals(db.client, TEST_USER)).data?.map((g) => g.id)).toEqual(['g-first', 'g-third']);
    expect((await listGoals(db.client, TEST_USER, true)).data?.map((g) => g.id)).toEqual([
      'g-first',
      'g-archived',
      'g-third',
    ]);
  });

  it('assigns new goals to the server-derived user', async () => {
    const { data } = await createGoal(db.client, TEST_USER, { title: 'Ship VozPilot', user_id: OTHER_USER } as never);

    expect(data?.user_id).toBe(TEST_USER);
  });
});

// ---------------------------------------------------------------------------
// Preferences — one row per user, upsert semantics
// ---------------------------------------------------------------------------
describe('preferences repository', () => {
  it('creates the row on first write and updates it afterwards', async () => {
    const first = await upsertPreferences(db.client, TEST_USER, { working_hours_start: '08:00' } as never);
    expect(first.error).toBeNull();
    expect(db.table('user_preferences')).toHaveLength(1);

    const second = await upsertPreferences(db.client, TEST_USER, { working_hours_end: '17:00' } as never);
    expect(second.data).toMatchObject({
      user_id: TEST_USER,
      working_hours_start: '08:00',
      working_hours_end: '17:00',
    });
    // Upsert must not accumulate a second row for the same user.
    expect(db.table('user_preferences')).toHaveLength(1);
  });

  it('keeps preferences isolated per user', async () => {
    await upsertPreferences(db.client, TEST_USER, { timezone: 'Europe/London' } as never);
    await upsertPreferences(db.client, OTHER_USER, { timezone: 'Asia/Tokyo' } as never);

    expect((await getPreferences(db.client, TEST_USER)).data?.timezone).toBe('Europe/London');
    expect((await getPreferences(db.client, OTHER_USER)).data?.timezone).toBe('Asia/Tokyo');
    expect(db.table('user_preferences')).toHaveLength(2);
  });

  it('returns null rather than throwing when no row exists yet', async () => {
    const { data, error } = await getPreferences(db.client, TEST_USER);
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('returns null for a missing profile instead of an error', async () => {
    const { data, error } = await getProfile(db.client, TEST_USER);
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Daily plans — unique on (user_id, plan_date)
// ---------------------------------------------------------------------------
describe('daily plan repository', () => {
  it('replaces the plan for a date instead of creating a duplicate', async () => {
    await upsertDailyPlan(db.client, TEST_USER, { plan_date: '2026-10-05', summary: 'First' } as never);
    await upsertDailyPlan(db.client, TEST_USER, { plan_date: '2026-10-05', summary: 'Second' } as never);

    const plans = db.table('daily_plans');
    expect(plans).toHaveLength(1);
    expect(plans[0].summary).toBe('Second');
  });

  it('allows the same date for different users', async () => {
    await upsertDailyPlan(db.client, TEST_USER, { plan_date: '2026-10-05', summary: 'Mine' } as never);
    await upsertDailyPlan(db.client, OTHER_USER, { plan_date: '2026-10-05', summary: 'Theirs' } as never);

    expect(db.table('daily_plans')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
describe('notification repository', () => {
  beforeEach(() => {
    db.seed('notifications', [
      { id: 'n1', user_id: TEST_USER, title: 'Unread one', category: 'agent', read_at: null, created_at: '2026-10-01T00:00:00.000Z' },
      { id: 'n2', user_id: TEST_USER, title: 'Unread two', category: 'system', read_at: null, created_at: '2026-10-02T00:00:00.000Z' },
      { id: 'n3', user_id: TEST_USER, title: 'Read', category: 'agent', read_at: '2026-10-01T00:00:00.000Z', created_at: '2026-09-30T00:00:00.000Z' },
      { id: 'n4', user_id: OTHER_USER, title: 'Someone else', category: 'agent', read_at: null, created_at: '2026-10-03T00:00:00.000Z' },
    ]);
  });

  it('lists newest first and caps at the limit', async () => {
    const { data } = await listNotifications(db.client, TEST_USER, { limit: 2 });
    expect(data?.map((n) => n.id)).toEqual(['n2', 'n1']);
  });

  it('filters unread and category, and never leaks other users', async () => {
    expect((await listNotifications(db.client, TEST_USER, { unreadOnly: true })).data?.map((n) => n.id)).toEqual(['n2', 'n1']);
    expect((await listNotifications(db.client, TEST_USER, { category: 'agent' })).data?.map((n) => n.id)).toEqual(['n1', 'n3']);
    expect((await listNotifications(db.client, TEST_USER)).data?.map((n) => n.id)).not.toContain('n4');
  });

  it('marks a single notification read for the owner only', async () => {
    const mine = await markNotificationRead(db.client, TEST_USER, 'n1');
    expect(mine.error).toBeNull();
    expect(mine.data?.read_at).not.toBeNull();

    const theirs = await markNotificationRead(db.client, TEST_USER, 'n4');
    expect(theirs.error?.message).toBe('Unable to update the notification.');
    expect(db.table('notifications').find((n) => n.id === 'n4')?.read_at).toBeNull();
  });

  it('marks all unread as read without touching already-read rows', async () => {
    const before = db.table('notifications').find((n) => n.id === 'n3')?.read_at;

    await markAllNotificationsRead(db.client, TEST_USER);

    expect(db.table('notifications').find((n) => n.id === 'n1')?.read_at).not.toBeNull();
    expect(db.table('notifications').find((n) => n.id === 'n2')?.read_at).not.toBeNull();
    expect(db.table('notifications').find((n) => n.id === 'n3')?.read_at).toBe(before);
    expect(db.table('notifications').find((n) => n.id === 'n4')?.read_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Search + integrations
// ---------------------------------------------------------------------------
describe('search and integrations', () => {
  it('searches across goals, projects, tasks and inbox for the owner only', async () => {
    db.seed('goals', [{ id: 'g1', user_id: TEST_USER, title: 'Learn violin' }]);
    db.seed('projects', [{ id: 'p1', user_id: TEST_USER, title: 'Recital prep' }]);
    db.seed('tasks', [
      { id: 't1', user_id: TEST_USER, title: 'Book rehearsal room' },
      { id: 't2', user_id: OTHER_USER, title: 'Book rehearsal room' },
    ]);
    db.seed('inbox_items', [
      { id: 'i1', user_id: TEST_USER, subject: 'Studio rehearsal', body: 'Available Thursday' },
      { id: 'i2', user_id: TEST_USER, subject: 'Unrelated', body: 'Book rehearsal room please' },
    ]);

    const { data } = await globalSearch(db.client, TEST_USER, 'rehearsal');

    expect(data?.goals).toHaveLength(0);
    expect(data?.projects).toHaveLength(0);
    expect(data?.tasks.map((t) => t.id)).toEqual(['t1']);
    expect(data?.inboxItems.map((i) => i.id)).toEqual(['i1', 'i2']);
  });

  it('sanitises LIKE wildcards in the search term', async () => {
    db.seed('tasks', [{ id: 't1', user_id: TEST_USER, title: '100% done' }]);

    // `%` must be treated as a literal, not as a match-everything wildcard.
    const { data } = await globalSearch(db.client, TEST_USER, '%');

    expect(data?.tasks).toHaveLength(0);
  });

  it('upserts integrations keyed on user and provider', async () => {
    await upsertIntegration(db.client, TEST_USER, 'google_calendar', { status: 'active' } as never);
    await upsertIntegration(db.client, TEST_USER, 'google_calendar', { status: 'revoked' } as never);
    await upsertIntegration(db.client, OTHER_USER, 'google_calendar', { status: 'active' } as never);

    const rows = db.table('integrations');
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.user_id === TEST_USER)?.status).toBe('revoked');
  });
});
