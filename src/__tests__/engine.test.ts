import { describe, expect, it } from 'vitest';
import {
  deadlineUrgency,
  explainScore,
  isBlocked,
  rankTasks,
  scorePriority,
} from '../lib/engine/priority';
import { computeGoalHealth, computeProjectHealth, dailyWorkload } from '../lib/engine/health';
import { buildDailyPlan, findConflicts, freeWindows } from '../lib/engine/planner';
import type { Goal, Priority, Project, Task } from '../lib/types';

const NOW = new Date('2026-10-05T09:00:00.000Z');

function task(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    user_id: 'u1',
    description: '',
    status: 'todo',
    priority: 'medium' as Priority,
    due_date: null,
    estimated_minutes: null,
    actual_minutes: null,
    project_id: null,
    goal_id: null,
    milestone_id: null,
    goal_milestone_id: null,
    scheduled_date: null,
    tags: [],
    source: 'manual',
    idempotency_key: null,
    started_at: null,
    completed_at: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  } as Task;
}

function project(overrides: Partial<Project> & { id: string; title: string }): Project {
  return {
    user_id: 'u1',
    description: '',
    status: 'active',
    priority: 'medium' as Priority,
    start_date: null,
    target_date: null,
    health: 100,
    risk: 0,
    health_note: '',
    notes: '',
    progress: 0,
    position: 0,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  } as Project;
}

function goal(overrides: Partial<Goal> & { id: string; title: string }): Goal {
  return {
    user_id: 'u1',
    description: '',
    category: 'career',
    priority: 'medium' as Priority,
    status: 'active',
    target_date: null,
    progress: 0,
    health: 100,
    health_note: '',
    color: 'violet',
    position: 0,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  } as Goal;
}

const inDays = (days: number) => {
  const date = new Date(NOW);
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

describe('priority scoring engine', () => {
  it('scores overdue critical work above a distant low-priority task', () => {
    const overdue = scorePriority({ task: task({ id: 'a', title: 'Ship report', priority: 'critical', due_date: inDays(-3) }), now: NOW });
    const distant = scorePriority({ task: task({ id: 'b', title: 'Read article', priority: 'low', due_date: inDays(20) }), now: NOW });

    expect(overdue.total).toBeGreaterThan(distant.total);
    expect(overdue.overdue).toBeGreaterThan(0);
    expect(distant.overdue).toBe(0);
  });

  it('raises the score when a task blocks other tasks', () => {
    const base = task({ id: 'a', title: 'Build API' });
    const plain = scorePriority({ task: base, now: NOW });
    const blocking = scorePriority({ task: base, now: NOW, blocksCount: new Map([['a', 3]]) });

    expect(blocking.dependencyImpact).toBeGreaterThan(plain.dependencyImpact);
    expect(blocking.total).toBeGreaterThan(plain.total);
  });

  it('includes project risk and goal relevance', () => {
    const risky = project({ id: 'p1', title: 'Risky', risk: 90 });
    const important = goal({ id: 'g1', title: 'Big goal', priority: 'critical' });
    const scored = scorePriority({
      task: task({ id: 'a', title: 'Task', project_id: 'p1', goal_id: 'g1' }),
      now: NOW,
      goals: new Map([['g1', important]]),
      projects: new Map([['p1', risky]]),
    });

    expect(scored.projectRisk).toBeGreaterThan(0);
    expect(scored.goalRelevance).toBeGreaterThan(0);
  });

  it('gives quick wins a small boost but never a negative total', () => {
    const quick = scorePriority({ task: task({ id: 'a', title: 'Quick', estimated_minutes: 20 }), now: NOW });
    const marathon = scorePriority({ task: task({ id: 'b', title: 'Marathon', estimated_minutes: 600 }), now: NOW });

    expect(quick.effortFit).toBeGreaterThan(marathon.effortFit);
    expect(marathon.total).toBeGreaterThanOrEqual(0);
  });

  it('never recommends completed, cancelled or dependency-blocked tasks', () => {
    const tasks = [
      task({ id: 'done', title: 'Done', status: 'completed' }),
      task({ id: 'cancelled', title: 'Cancelled', status: 'cancelled' }),
      task({ id: 'blocked', title: 'Blocked', status: 'blocked' }),
      task({ id: 'waiting', title: 'Waiting' }),
      task({ id: 'open', title: 'Open' }),
    ];
    const ranked = rankTasks(tasks, { now: NOW, blockedTaskIds: new Set(['waiting']) });

    expect(ranked.map((entry) => entry.task.id)).toEqual(['open']);
    expect(isBlocked(tasks[3], new Set(['waiting']))).toBe(true);
    expect(isBlocked(tasks[4], new Set(['waiting']))).toBe(false);
  });

  it('is deterministic: identical inputs produce identical ordering', () => {
    const tasks = [
      task({ id: 'a', title: 'A', due_date: inDays(1) }),
      task({ id: 'b', title: 'B', due_date: inDays(1) }),
      task({ id: 'c', title: 'C', due_date: inDays(2) }),
    ];
    const first = rankTasks(tasks, { now: NOW }).map((entry) => entry.task.id);
    const second = rankTasks([...tasks].reverse(), { now: NOW }).map((entry) => entry.task.id);
    expect(first).toEqual(second);
  });

  it('explains its reasoning in natural language', () => {
    const breakdown = scorePriority({ task: task({ id: 'a', title: 'X', priority: 'critical', due_date: inDays(-1) }), now: NOW });
    const explanation = explainScore(breakdown);
    expect(explanation).toContain('overdue');
    expect(explanation.length).toBeGreaterThan(10);
  });

  it('urgency curve decays to zero beyond 14 days', () => {
    expect(deadlineUrgency(inDays(0), NOW)).toBe(1);
    expect(deadlineUrgency(inDays(7), NOW)).toBeCloseTo(0.5, 1);
    expect(deadlineUrgency(inDays(30), NOW)).toBe(0);
    expect(deadlineUrgency(null, NOW)).toBe(0);
  });
});

describe('project health', () => {
  const baseProject = project({ id: 'p1', title: 'VozPilot' });

  it('reports 100% health for a project with no problems', () => {
    const health = computeProjectHealth({
      project: baseProject,
      tasks: [task({ id: 't1', title: 'A', status: 'completed', project_id: 'p1' })],
      milestones: [],
      now: NOW,
    });
    expect(health.score).toBeGreaterThanOrEqual(85);
    expect(health.label).toBe('excellent');
    expect(health.metrics.progress).toBe(100);
  });

  it('penalises overdue, blocked and due-soon tasks', () => {
    const health = computeProjectHealth({
      project: baseProject,
      tasks: [
        task({ id: 't1', title: 'Overdue', project_id: 'p1', due_date: inDays(-2) }),
        task({ id: 't2', title: 'Blocked', project_id: 'p1', status: 'blocked' }),
        task({ id: 't3', title: 'Soon', project_id: 'p1', due_date: inDays(2) }),
      ],
      milestones: [],
      now: NOW,
    });

    expect(health.metrics.overdueTasks).toBe(1);
    expect(health.metrics.blockedTasks).toBe(1);
    expect(health.metrics.dueSoonTasks).toBe(1);
    expect(health.score).toBeLessThan(60);
    expect(health.reasons.join(' ')).toMatch(/overdue/i);
  });

  it('flags a passed target date', () => {
    const health = computeProjectHealth({
      project: project({ id: 'p1', title: 'Late', target_date: '2026-09-01' }),
      tasks: [],
      milestones: [],
      now: NOW,
    });
    expect(health.reasons.join(' ')).toMatch(/target date has passed/i);
    expect(health.score).toBeLessThan(90);
  });

  it('computes milestone completion independently of tasks', () => {
    const health = computeProjectHealth({
      project: baseProject,
      tasks: [],
      milestones: [
        { id: 'm1', user_id: 'u1', project_id: 'p1', title: 'One', description: '', due_date: null, status: 'completed', position: 0, completed_at: null, created_at: '', updated_at: '' },
        { id: 'm2', user_id: 'u1', project_id: 'p1', title: 'Two', description: '', due_date: null, status: 'pending', position: 1, completed_at: null, created_at: '', updated_at: '' },
      ],
      now: NOW,
    });
    expect(health.metrics.milestoneCompletion).toBe(50);
    expect(health.metrics.progress).toBe(50);
  });
});

describe('goal health', () => {
  it('blends project health and milestone completion', () => {
    const g = goal({ id: 'g1', title: 'Become job-ready' });
    const projects = [
      project({ id: 'p1', title: 'Portfolio', goal_id: 'g1', health: 50 }),
      project({ id: 'p2', title: 'Practice', goal_id: 'g1', health: 40 }),
    ];
    const health = computeGoalHealth({
      goal: g,
      projects,
      tasks: [task({ id: 't1', title: 'A', goal_id: 'g1', status: 'completed' })],
      milestones: [
        { id: 'm1', goal_id: 'g1', status: 'completed', due_date: null },
        { id: 'm2', goal_id: 'g1', status: 'pending', due_date: null },
      ],
      now: NOW,
    });

    expect(health.metrics.progress).toBe(50);
    expect(health.metrics.milestoneCompletion).toBe(50);
    expect(health.reasons.join(' ')).toMatch(/unhealthy/i);
  });

  it('warns when no projects are linked', () => {
    const health = computeGoalHealth({ goal: goal({ id: 'g1', title: 'X' }), projects: [], tasks: [], milestones: [], now: NOW });
    expect(health.reasons.join(' ')).toMatch(/no projects linked/i);
  });
});

describe('daily workload', () => {
  it('detects overload from real estimates', () => {
    const tasks = [
      task({ id: 'a', title: 'A', estimated_minutes: 240 }),
      task({ id: 'b', title: 'B', estimated_minutes: 240 }),
      task({ id: 'c', title: 'C', estimated_minutes: 240 }),
    ];
    const workload = dailyWorkload(tasks, { now: NOW, availableMinutes: 480 });
    expect(workload.plannedMinutes).toBe(720);
    expect(workload.overloaded).toBe(true);
    expect(workload.utilisation).toBe(150);
  });
});

describe('VozDay planner', () => {
  const date = '2026-10-05';
  const timezone = 'UTC';

  it('splits the workday around fixed commitments', () => {
    const workday = { start: new Date('2026-10-05T09:00:00Z'), end: new Date('2026-10-05T17:00:00Z') };
    const windows = freeWindows(workday, [{ start: new Date('2026-10-05T11:00:00Z'), end: new Date('2026-10-05T12:00:00Z') }]);

    expect(windows).toHaveLength(2);
    expect(windows[0].start.toISOString()).toBe('2026-10-05T09:00:00.000Z');
    expect(windows[0].end.toISOString()).toBe('2026-10-05T11:00:00.000Z');
    expect(windows[1].start.toISOString()).toBe('2026-10-05T12:00:00.000Z');
    expect(windows[1].end.toISOString()).toBe('2026-10-05T17:00:00.000Z');
  });

  it('never schedules overlapping blocks', () => {
    const plan = buildDailyPlan({
      date,
      timezone,
      workdayStart: '09:00',
      workdayEnd: '17:00',
      breakMinutes: 10,
      maxDailyBlocks: 8,
      tasks: [
        { id: 'a', title: 'Task A', priority: 'high', status: 'todo', estimated_minutes: 90, due_date: null, project_id: null, goal_id: null },
        { id: 'b', title: 'Task B', priority: 'high', status: 'todo', estimated_minutes: 90, due_date: null, project_id: null, goal_id: null },
      ],
      commitments: [{ id: 'c1', title: 'College', start_at: '2026-10-05T09:00:00Z', end_at: '2026-10-05T10:00:00Z', kind: 'commitment' }],
      now: NOW,
    });

    const sorted = [...plan.blocks].sort((a, b) => a.start_at.localeCompare(b.start_at));
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index].start_at >= sorted[index - 1].end_at).toBe(true);
    }
    expect(plan.blocks[0].start_at).toBe('2026-10-05T10:00:00.000Z');
  });

  it('respects the maximum focus-block budget and reports what did not fit', () => {
    const plan = buildDailyPlan({
      date,
      timezone,
      workdayStart: '09:00',
      workdayEnd: '11:00',
      breakMinutes: 0,
      maxDailyBlocks: 1,
      tasks: [
        { id: 'a', title: 'First', priority: 'critical', status: 'todo', estimated_minutes: 45, due_date: null, project_id: null, goal_id: null },
        { id: 'b', title: 'Second', priority: 'high', status: 'todo', estimated_minutes: 45, due_date: null, project_id: null, goal_id: null },
      ],
      now: NOW,
    });

    expect(plan.blocks.filter((block) => block.kind === 'focus')).toHaveLength(1);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toMatch(/budget/i);
  });

  it('never schedules tasks whose dependencies are unfinished', () => {
    const plan = buildDailyPlan({
      date,
      timezone,
      workdayStart: '09:00',
      workdayEnd: '12:00',
      breakMinutes: 0,
      maxDailyBlocks: 4,
      tasks: [
        { id: 'a', title: 'Blocked work', priority: 'critical', status: 'todo', estimated_minutes: 30, due_date: null, project_id: null, goal_id: null },
      ],
      blockedTaskIds: new Set(['a']),
      now: NOW,
    });

    expect(plan.blocks).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/dependenc/i);
  });

  it('inserts breaks after sustained focus', () => {
    const plan = buildDailyPlan({
      date,
      timezone,
      workdayStart: '09:00',
      workdayEnd: '13:00',
      breakMinutes: 15,
      maxDailyBlocks: 6,
      tasks: [
        { id: 'a', title: 'Long task', priority: 'high', status: 'todo', estimated_minutes: 120, due_date: null, project_id: null, goal_id: null },
      ],
      now: NOW,
    });

    const kinds = plan.blocks.map((block) => block.kind);
    expect(kinds).toContain('break');
    expect(plan.blocks.find((block) => block.kind === 'break')?.title).toBe('Break');
  });

  it('produces a human-readable summary', () => {
    const plan = buildDailyPlan({
      date,
      timezone,
      workdayStart: '09:00',
      workdayEnd: '10:00',
      breakMinutes: 0,
      maxDailyBlocks: 2,
      tasks: [{ id: 'a', title: 'Task', priority: 'high', status: 'todo', estimated_minutes: 30, due_date: null, project_id: null, goal_id: null }],
      now: NOW,
    });
    expect(plan.summary).toMatch(/focus block/);
    expect(plan.blocks).toHaveLength(1);
  });
});

describe('schedule conflict detection', () => {
  it('detects overlapping blocks', () => {
    const existing = [{ id: 'b1', title: 'College', start_at: '2026-10-05T09:00:00Z', end_at: '2026-10-05T10:00:00Z' }];
    expect(findConflicts({ start_at: '2026-10-05T09:30:00Z', end_at: '2026-10-05T10:30:00Z' }, existing)).toHaveLength(1);
    expect(findConflicts({ start_at: '2026-10-05T10:00:00Z', end_at: '2026-10-05T11:00:00Z' }, existing)).toHaveLength(0);
  });
});
