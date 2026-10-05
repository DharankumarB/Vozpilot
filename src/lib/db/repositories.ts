/**
 * Repositories — the only place that talks to the database.
 *
 * Every function takes `userId` and scopes the query with `.eq('user_id', …)`.
 * Row Level Security is the second line of defence: even if a scope is missed,
 * Postgres refuses to return another user's row.
 */

import type {
  AiMessage,
  AiPermissions,
  AiConversation,
  AgentAction,
  AgentRun,
  DailyPlan,
  Goal,
  GoalMilestone,
  InboxAction,
  InboxItem,
  Integration,
  Memory,
  Notification,
  Profile,
  Project,
  ProjectMilestone,
  Task,
  TaskDependency,
  TimeBlock,
  UserPreferences,
} from '../types';
import { DbFailure, describeDbError, type DbClient, type DbResponse } from './client';

type Row<T> = DbResponse<T>;

const fail = <T>(error: { message: string; code?: string } | null, context: string): Row<T> => ({
  data: null,
  error: describeDbError(error, context),
});

// ---------------------------------------------------------------------------
// Profiles / preferences / permissions
// ---------------------------------------------------------------------------
export async function getProfile(db: DbClient, userId: string): Promise<Row<Profile>> {
  const { data, error } = await db.from<Profile>('profiles').select('*').eq('id', userId).maybeSingle();
  return error ? fail<Profile>(error, 'Unable to load your profile.') : { data, error: null };
}

export async function updateProfile(db: DbClient, userId: string, patch: Partial<Profile>): Promise<Row<Profile>> {
  const { data, error } = await db
    .from<Profile>('profiles')
    .update(patch)
    .eq('id', userId)
    .select('*')
    .single();
  return error ? fail<Profile>(error, 'Unable to update your profile.') : { data, error: null };
}

export async function getPreferences(db: DbClient, userId: string): Promise<Row<UserPreferences>> {
  const { data, error } = await db.from<UserPreferences>('user_preferences').select('*').eq('user_id', userId).maybeSingle();
  return error ? fail<UserPreferences>(error, 'Unable to load your preferences.') : { data, error: null };
}

export async function upsertPreferences(
  db: DbClient,
  userId: string,
  patch: Partial<UserPreferences>,
): Promise<Row<UserPreferences>> {
  const { data, error } = await db
    .from<UserPreferences>('user_preferences')
    .upsert({ ...patch, user_id: userId }, { onConflict: 'user_id' })
    .select('*')
    .single();
  return error ? fail<UserPreferences>(error, 'Unable to save your preferences.') : { data, error: null };
}

export async function getPermissions(db: DbClient, userId: string): Promise<Row<AiPermissions>> {
  const { data, error } = await db.from<AiPermissions>('ai_permissions').select('*').eq('user_id', userId).maybeSingle();
  return error ? fail<AiPermissions>(error, 'Unable to load AI permissions.') : { data, error: null };
}

export async function upsertPermissions(
  db: DbClient,
  userId: string,
  patch: Partial<AiPermissions>,
): Promise<Row<AiPermissions>> {
  const { data, error } = await db
    .from<AiPermissions>('ai_permissions')
    .upsert({ ...patch, user_id: userId }, { onConflict: 'user_id' })
    .select('*')
    .single();
  return error ? fail<AiPermissions>(error, 'Unable to save AI permissions.') : { data, error: null };
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------
export async function listGoals(db: DbClient, userId: string, includeArchived = false): Promise<Row<Goal[]>> {
  let query = db.from<Goal>('goals').select('*').eq('user_id', userId).order('position', { ascending: true }).order('created_at', { ascending: false });
  if (!includeArchived) query = query.neq('status', 'archived');
  const { data, error } = await query;
  return error ? fail<Goal[]>(error, 'Unable to load goals.') : { data: data ?? [], error: null };
}

export async function getGoal(db: DbClient, userId: string, goalId: string): Promise<Row<Goal>> {
  const { data, error } = await db.from<Goal>('goals').select('*').eq('user_id', userId).eq('id', goalId).maybeSingle();
  return error ? fail<Goal>(error, 'Unable to load that goal.') : { data, error: null };
}

export async function createGoal(db: DbClient, userId: string, values: Partial<Goal>): Promise<Row<Goal>> {
  const { data, error } = await db.from<Goal>('goals').insert({ ...values, user_id: userId }).select('*').single();
  return error ? fail<Goal>(error, 'Unable to create the goal.') : { data, error: null };
}

export async function updateGoal(db: DbClient, userId: string, goalId: string, patch: Partial<Goal>): Promise<Row<Goal>> {
  const { data, error } = await db
    .from<Goal>('goals')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', goalId)
    .select('*')
    .single();
  return error ? fail<Goal>(error, 'Unable to update the goal.') : { data, error: null };
}

export async function deleteGoal(db: DbClient, userId: string, goalId: string): Promise<Row<null>> {
  const { error } = await db.from<Goal>('goals').delete().eq('user_id', userId).eq('id', goalId);
  return error ? fail<null>(error, 'Unable to delete the goal.') : { data: null, error: null };
}

export async function listGoalMilestones(db: DbClient, userId: string, goalId?: string): Promise<Row<GoalMilestone[]>> {
  let query = db.from<GoalMilestone>('goal_milestones').select('*').eq('user_id', userId).order('position', { ascending: true });
  if (goalId) query = query.eq('goal_id', goalId);
  const { data, error } = await query;
  return error ? fail<GoalMilestone[]>(error, 'Unable to load milestones.') : { data: data ?? [], error: null };
}

export async function createGoalMilestone(
  db: DbClient,
  userId: string,
  values: Partial<GoalMilestone>,
): Promise<Row<GoalMilestone>> {
  const { data, error } = await db
    .from<GoalMilestone>('goal_milestones')
    .insert({ ...values, user_id: userId })
    .select('*')
    .single();
  return error ? fail<GoalMilestone>(error, 'Unable to create the milestone.') : { data, error: null };
}

export async function updateGoalMilestone(
  db: DbClient,
  userId: string,
  milestoneId: string,
  patch: Partial<GoalMilestone>,
): Promise<Row<GoalMilestone>> {
  const { data, error } = await db
    .from<GoalMilestone>('goal_milestones')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', milestoneId)
    .select('*')
    .single();
  return error ? fail<GoalMilestone>(error, 'Unable to update the milestone.') : { data, error: null };
}

export async function deleteGoalMilestone(db: DbClient, userId: string, milestoneId: string): Promise<Row<null>> {
  const { error } = await db.from<GoalMilestone>('goal_milestones').delete().eq('user_id', userId).eq('id', milestoneId);
  return error ? fail<null>(error, 'Unable to delete the milestone.') : { data: null, error: null };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
export async function listProjects(db: DbClient, userId: string, includeArchived = false): Promise<Row<Project[]>> {
  let query = db.from<Project>('projects').select('*').eq('user_id', userId).order('position', { ascending: true }).order('created_at', { ascending: false });
  if (!includeArchived) query = query.neq('status', 'archived');
  const { data, error } = await query;
  return error ? fail<Project[]>(error, 'Unable to load projects.') : { data: data ?? [], error: null };
}

export async function getProject(db: DbClient, userId: string, projectId: string): Promise<Row<Project>> {
  const { data, error } = await db.from<Project>('projects').select('*').eq('user_id', userId).eq('id', projectId).maybeSingle();
  return error ? fail<Project>(error, 'Unable to load that project.') : { data, error: null };
}

export async function createProject(db: DbClient, userId: string, values: Partial<Project>): Promise<Row<Project>> {
  const { data, error } = await db.from<Project>('projects').insert({ ...values, user_id: userId }).select('*').single();
  return error ? fail<Project>(error, 'Unable to create the project.') : { data, error: null };
}

export async function updateProject(db: DbClient, userId: string, projectId: string, patch: Partial<Project>): Promise<Row<Project>> {
  const { data, error } = await db
    .from<Project>('projects')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', projectId)
    .select('*')
    .single();
  return error ? fail<Project>(error, 'Unable to update the project.') : { data, error: null };
}

export async function deleteProject(db: DbClient, userId: string, projectId: string): Promise<Row<null>> {
  const { error } = await db.from<Project>('projects').delete().eq('user_id', userId).eq('id', projectId);
  return error ? fail<null>(error, 'Unable to delete the project.') : { data: null, error: null };
}

export async function listProjectMilestones(db: DbClient, userId: string, projectId?: string): Promise<Row<ProjectMilestone[]>> {
  let query = db.from<ProjectMilestone>('project_milestones').select('*').eq('user_id', userId).order('position', { ascending: true });
  if (projectId) query = query.eq('project_id', projectId);
  const { data, error } = await query;
  return error ? fail<ProjectMilestone[]>(error, 'Unable to load milestones.') : { data: data ?? [], error: null };
}

export async function createProjectMilestone(
  db: DbClient,
  userId: string,
  values: Partial<ProjectMilestone>,
): Promise<Row<ProjectMilestone>> {
  const { data, error } = await db
    .from<ProjectMilestone>('project_milestones')
    .insert({ ...values, user_id: userId })
    .select('*')
    .single();
  return error ? fail<ProjectMilestone>(error, 'Unable to create the milestone.') : { data, error: null };
}

export async function updateProjectMilestone(
  db: DbClient,
  userId: string,
  milestoneId: string,
  patch: Partial<ProjectMilestone>,
): Promise<Row<ProjectMilestone>> {
  const { data, error } = await db
    .from<ProjectMilestone>('project_milestones')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', milestoneId)
    .select('*')
    .single();
  return error ? fail<ProjectMilestone>(error, 'Unable to update the milestone.') : { data, error: null };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
export interface TaskFilter {
  status?: string[];
  projectId?: string;
  goalId?: string;
  dueBefore?: string;
  dueAfter?: string;
  limit?: number;
}

export async function listTasks(db: DbClient, userId: string, filter: TaskFilter = {}): Promise<Row<Task[]>> {
  let query = db.from<Task>('tasks').select('*').eq('user_id', userId).order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
  if (filter.status && filter.status.length > 0) query = query.in('status', filter.status);
  if (filter.projectId) query = query.eq('project_id', filter.projectId);
  if (filter.goalId) query = query.eq('goal_id', filter.goalId);
  if (filter.dueBefore) query = query.lte('due_date', filter.dueBefore);
  if (filter.dueAfter) query = query.gte('due_date', filter.dueAfter);
  if (filter.limit) query = query.limit(filter.limit);
  const { data, error } = await query;
  return error ? fail<Task[]>(error, 'Unable to load tasks.') : { data: data ?? [], error: null };
}

export async function getTask(db: DbClient, userId: string, taskId: string): Promise<Row<Task>> {
  const { data, error } = await db.from<Task>('tasks').select('*').eq('user_id', userId).eq('id', taskId).maybeSingle();
  return error ? fail<Task>(error, 'Unable to load that task.') : { data, error: null };
}

export async function createTask(db: DbClient, userId: string, values: Partial<Task>): Promise<Row<Task>> {
  const { data, error } = await db.from<Task>('tasks').insert({ ...values, user_id: userId }).select('*').single();
  return error ? fail<Task>(error, 'Unable to create the task.') : { data, error: null };
}

export async function updateTask(db: DbClient, userId: string, taskId: string, patch: Partial<Task>): Promise<Row<Task>> {
  const { data, error } = await db
    .from<Task>('tasks')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', taskId)
    .select('*')
    .single();
  return error ? fail<Task>(error, 'Unable to update the task.') : { data, error: null };
}

export async function deleteTask(db: DbClient, userId: string, taskId: string): Promise<Row<null>> {
  const { error } = await db.from<Task>('tasks').delete().eq('user_id', userId).eq('id', taskId);
  return error ? fail<null>(error, 'Unable to delete the task.') : { data: null, error: null };
}

// ---------------------------------------------------------------------------
// Task dependencies
// ---------------------------------------------------------------------------
export async function listDependencies(db: DbClient, userId: string): Promise<Row<TaskDependency[]>> {
  const { data, error } = await db.from<TaskDependency>('task_dependencies').select('*').eq('user_id', userId);
  return error ? fail<TaskDependency[]>(error, 'Unable to load dependencies.') : { data: data ?? [], error: null };
}

export async function createDependency(
  db: DbClient,
  userId: string,
  values: { task_id: string; depends_on_task_id: string },
): Promise<Row<TaskDependency>> {
  const { data, error } = await db
    .from<TaskDependency>('task_dependencies')
    .insert({ ...values, user_id: userId })
    .select('*')
    .single();
  return error ? fail<TaskDependency>(error, 'Unable to create the dependency.') : { data, error: null };
}

export async function deleteDependency(db: DbClient, userId: string, dependencyId: string): Promise<Row<null>> {
  const { error } = await db.from<TaskDependency>('task_dependencies').delete().eq('user_id', userId).eq('id', dependencyId);
  return error ? fail<null>(error, 'Unable to remove the dependency.') : { data: null, error: null };
}

/** task_id -> ids it must wait for */
export function dependencyMap(dependencies: TaskDependency[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const dependency of dependencies) {
    const list = map.get(dependency.task_id) ?? [];
    list.push(dependency.depends_on_task_id);
    map.set(dependency.task_id, list);
  }
  return map;
}

/** task_id -> how many tasks are waiting on it */
export function blockedByMap(dependencies: TaskDependency[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const dependency of dependencies) {
    map.set(dependency.depends_on_task_id, (map.get(dependency.depends_on_task_id) ?? 0) + 1);
  }
  return map;
}

/** Ids of tasks whose dependencies are not all completed. */
export function blockedTaskIds(tasks: Task[], dependencies: TaskDependency[]): Set<string> {
  const completed = new Set(tasks.filter((task) => task.status === 'completed').map((task) => task.id));
  const blocked = new Set<string>();
  for (const dependency of dependencies) {
    if (!completed.has(dependency.depends_on_task_id)) blocked.add(dependency.task_id);
  }
  return blocked;
}

// ---------------------------------------------------------------------------
// Daily plans + time blocks
// ---------------------------------------------------------------------------
export async function getDailyPlan(db: DbClient, userId: string, planDate: string): Promise<Row<DailyPlan>> {
  const { data, error } = await db
    .from<DailyPlan>('daily_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_date', planDate)
    .maybeSingle();
  return error ? fail<DailyPlan>(error, 'Unable to load the daily plan.') : { data, error: null };
}

export async function upsertDailyPlan(db: DbClient, userId: string, values: Partial<DailyPlan>): Promise<Row<DailyPlan>> {
  const { data, error } = await db
    .from<DailyPlan>('daily_plans')
    .upsert({ ...values, user_id: userId }, { onConflict: 'user_id,plan_date' })
    .select('*')
    .single();
  return error ? fail<DailyPlan>(error, 'Unable to save the daily plan.') : { data, error: null };
}

export async function listTimeBlocks(db: DbClient, userId: string, from: string, to: string): Promise<Row<TimeBlock[]>> {
  const { data, error } = await db
    .from<TimeBlock>('time_blocks')
    .select('*')
    .eq('user_id', userId)
    .gte('start_at', from)
    .lte('start_at', to)
    .order('start_at', { ascending: true });
  return error ? fail<TimeBlock[]>(error, 'Unable to load the schedule.') : { data: data ?? [], error: null };
}

export async function listTimeBlocksForPlan(db: DbClient, userId: string, planId: string): Promise<Row<TimeBlock[]>> {
  const { data, error } = await db
    .from<TimeBlock>('time_blocks')
    .select('*')
    .eq('user_id', userId)
    .eq('daily_plan_id', planId)
    .order('position', { ascending: true });
  return error ? fail<TimeBlock[]>(error, 'Unable to load the schedule.') : { data: data ?? [], error: null };
}

export async function createTimeBlock(db: DbClient, userId: string, values: Partial<TimeBlock>): Promise<Row<TimeBlock>> {
  const { data, error } = await db.from<TimeBlock>('time_blocks').insert({ ...values, user_id: userId }).select('*').single();
  return error ? fail<TimeBlock>(error, 'Unable to create the time block.') : { data, error: null };
}

export async function updateTimeBlock(db: DbClient, userId: string, blockId: string, patch: Partial<TimeBlock>): Promise<Row<TimeBlock>> {
  const { data, error } = await db
    .from<TimeBlock>('time_blocks')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', blockId)
    .select('*')
    .single();
  return error ? fail<TimeBlock>(error, 'Unable to update the time block.') : { data, error: null };
}

export async function deleteTimeBlock(db: DbClient, userId: string, blockId: string): Promise<Row<null>> {
  const { error } = await db.from<TimeBlock>('time_blocks').delete().eq('user_id', userId).eq('id', blockId);
  return error ? fail<null>(error, 'Unable to delete the time block.') : { data: null, error: null };
}

export async function deleteTimeBlocksForPlan(db: DbClient, userId: string, planId: string): Promise<Row<null>> {
  const { error } = await db.from<TimeBlock>('time_blocks').delete().eq('user_id', userId).eq('daily_plan_id', planId);
  return error ? fail<null>(error, 'Unable to clear the plan.') : { data: null, error: null };
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
export async function listInboxItems(db: DbClient, userId: string, status?: string[]): Promise<Row<InboxItem[]>> {
  let query = db.from<InboxItem>('inbox_items').select('*').eq('user_id', userId).order('received_at', { ascending: false });
  if (status && status.length > 0) query = query.in('status', status);
  const { data, error } = await query;
  return error ? fail<InboxItem[]>(error, 'Unable to load the inbox.') : { data: data ?? [], error: null };
}

export async function getInboxItem(db: DbClient, userId: string, itemId: string): Promise<Row<InboxItem>> {
  const { data, error } = await db.from<InboxItem>('inbox_items').select('*').eq('user_id', userId).eq('id', itemId).maybeSingle();
  return error ? fail<InboxItem>(error, 'Unable to load that inbox item.') : { data, error: null };
}

export async function createInboxItem(db: DbClient, userId: string, values: Partial<InboxItem>): Promise<Row<InboxItem>> {
  const { data, error } = await db.from<InboxItem>('inbox_items').insert({ ...values, user_id: userId }).select('*').single();
  return error ? fail<InboxItem>(error, 'Unable to save the inbox item.') : { data, error: null };
}

export async function updateInboxItem(db: DbClient, userId: string, itemId: string, patch: Partial<InboxItem>): Promise<Row<InboxItem>> {
  const { data, error } = await db
    .from<InboxItem>('inbox_items')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', itemId)
    .select('*')
    .single();
  return error ? fail<InboxItem>(error, 'Unable to update the inbox item.') : { data, error: null };
}

export async function deleteInboxItem(db: DbClient, userId: string, itemId: string): Promise<Row<null>> {
  const { error } = await db.from<InboxItem>('inbox_items').delete().eq('user_id', userId).eq('id', itemId);
  return error ? fail<null>(error, 'Unable to delete the inbox item.') : { data: null, error: null };
}

export async function listInboxActions(db: DbClient, userId: string, itemId?: string): Promise<Row<InboxAction[]>> {
  let query = db.from<InboxAction>('inbox_actions').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (itemId) query = query.eq('inbox_item_id', itemId);
  const { data, error } = await query;
  return error ? fail<InboxAction[]>(error, 'Unable to load inbox actions.') : { data: data ?? [], error: null };
}

export async function createInboxAction(db: DbClient, userId: string, values: Partial<InboxAction>): Promise<Row<InboxAction>> {
  const { data, error } = await db.from<InboxAction>('inbox_actions').insert({ ...values, user_id: userId }).select('*').single();
  return error ? fail<InboxAction>(error, 'Unable to create the action.') : { data, error: null };
}

export async function updateInboxAction(db: DbClient, userId: string, actionId: string, patch: Partial<InboxAction>): Promise<Row<InboxAction>> {
  const { data, error } = await db
    .from<InboxAction>('inbox_actions')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', actionId)
    .select('*')
    .single();
  return error ? fail<InboxAction>(error, 'Unable to update the action.') : { data, error: null };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export async function listNotifications(
  db: DbClient,
  userId: string,
  options: { unreadOnly?: boolean; category?: string; limit?: number } = {},
): Promise<Row<Notification[]>> {
  let query = db
    .from<Notification>('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 50);
  if (options.unreadOnly) query = query.is('read_at', null);
  if (options.category && options.category !== 'all') query = query.eq('category', options.category);
  const { data, error } = await query;
  return error ? fail<Notification[]>(error, 'Unable to load notifications.') : { data: data ?? [], error: null };
}

export async function createNotification(db: DbClient, userId: string, values: Partial<Notification>): Promise<Row<Notification>> {
  const { data, error } = await db.from<Notification>('notifications').insert({ ...values, user_id: userId }).select('*').single();
  return error ? fail<Notification>(error, 'Unable to create the notification.') : { data, error: null };
}

export async function markNotificationRead(db: DbClient, userId: string, notificationId: string): Promise<Row<Notification>> {
  const { data, error } = await db
    .from<Notification>('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', notificationId)
    .select('*')
    .single();
  return error ? fail<Notification>(error, 'Unable to update the notification.') : { data, error: null };
}

export async function markAllNotificationsRead(db: DbClient, userId: string): Promise<Row<null>> {
  const { error } = await db
    .from<Notification>('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  return error ? fail<null>(error, 'Unable to update notifications.') : { data: null, error: null };
}

export async function countUnreadNotifications(db: DbClient, userId: string): Promise<number> {
  const { data, error } = await db.from<Notification>('notifications').select('*').eq('user_id', userId).is('read_at', null);
  if (error || !data) return 0;
  return data.length;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------
export async function listMemories(db: DbClient, userId: string): Promise<Row<Memory[]>> {
  const { data, error } = await db
    .from<Memory>('memories')
    .select('*')
    .eq('user_id', userId)
    .order('pinned', { ascending: false })
    .order('importance', { ascending: false });
  return error ? fail<Memory[]>(error, 'Unable to load memories.') : { data: data ?? [], error: null };
}

export async function createMemory(db: DbClient, userId: string, values: Partial<Memory>): Promise<Row<Memory>> {
  const { data, error } = await db.from<Memory>('memories').insert({ ...values, user_id: userId }).select('*').single();
  return error ? fail<Memory>(error, 'Unable to save the memory.') : { data, error: null };
}

export async function updateMemory(db: DbClient, userId: string, memoryId: string, patch: Partial<Memory>): Promise<Row<Memory>> {
  const { data, error } = await db
    .from<Memory>('memories')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', memoryId)
    .select('*')
    .single();
  return error ? fail<Memory>(error, 'Unable to update the memory.') : { data, error: null };
}

export async function deleteMemory(db: DbClient, userId: string, memoryId: string): Promise<Row<null>> {
  const { error } = await db.from<Memory>('memories').delete().eq('user_id', userId).eq('id', memoryId);
  return error ? fail<null>(error, 'Unable to delete the memory.') : { data: null, error: null };
}

// ---------------------------------------------------------------------------
// Agent runs + actions
// ---------------------------------------------------------------------------
export async function createAgentRun(db: DbClient, userId: string, values: Partial<AgentRun>): Promise<Row<AgentRun>> {
  const { data, error } = await db.from<AgentRun>('agent_runs').insert({ ...values, user_id: userId }).select('*').single();
  return error ? fail<AgentRun>(error, 'Unable to start the agent run.') : { data, error: null };
}

export async function finishAgentRun(db: DbClient, userId: string, runId: string, patch: Partial<AgentRun>): Promise<Row<AgentRun>> {
  const { data, error } = await db
    .from<AgentRun>('agent_runs')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', runId)
    .select('*')
    .single();
  return error ? fail<AgentRun>(error, 'Unable to finish the agent run.') : { data, error: null };
}

export async function createAgentAction(db: DbClient, userId: string, values: Partial<AgentAction>): Promise<Row<AgentAction>> {
  const { data, error } = await db.from<AgentAction>('agent_actions').insert({ ...values, user_id: userId }).select('*').single();
  return error ? fail<AgentAction>(error, 'Unable to log the agent action.') : { data, error: null };
}

export async function listAgentActions(
  db: DbClient,
  userId: string,
  options: { agent?: string; tool?: string; limit?: number } = {},
): Promise<Row<AgentAction[]>> {
  let query = db
    .from<AgentAction>('agent_actions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 100);
  if (options.agent) query = query.eq('agent', options.agent);
  if (options.tool) query = query.eq('tool', options.tool);
  const { data, error } = await query;
  return error ? fail<AgentAction[]>(error, 'Unable to load agent activity.') : { data: data ?? [], error: null };
}

// ---------------------------------------------------------------------------
// AI conversations
// ---------------------------------------------------------------------------
export async function createConversation(db: DbClient, userId: string, title: string): Promise<Row<AiConversation>> {
  const { data, error } = await db
    .from<AiConversation>('ai_conversations')
    .insert({ user_id: userId, title })
    .select('*')
    .single();
  return error ? fail<AiConversation>(error, 'Unable to create the conversation.') : { data, error: null };
}

export async function listMessages(db: DbClient, userId: string, conversationId: string): Promise<Row<AiMessage[]>> {
  const { data, error } = await db
    .from<AiMessage>('ai_messages')
    .select('*')
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  return error ? fail<AiMessage[]>(error, 'Unable to load the conversation.') : { data: data ?? [], error: null };
}

export async function createMessage(db: DbClient, userId: string, values: Partial<AiMessage>): Promise<Row<AiMessage>> {
  const { data, error } = await db.from<AiMessage>('ai_messages').insert({ ...values, user_id: userId }).select('*').single();
  return error ? fail<AiMessage>(error, 'Unable to save the message.') : { data, error: null };
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------
export async function listIntegrations(db: DbClient, userId: string): Promise<Row<Integration[]>> {
  const { data, error } = await db.from<Integration>('integrations').select('*').eq('user_id', userId).order('provider', { ascending: true });
  return error ? fail<Integration[]>(error, 'Unable to load integrations.') : { data: data ?? [], error: null };
}

export async function upsertIntegration(
  db: DbClient,
  userId: string,
  provider: string,
  values: Partial<Integration>,
): Promise<Row<Integration>> {
  const { data, error } = await db
    .from<Integration>('integrations')
    .upsert({ ...values, user_id: userId, provider: provider as Integration['provider'] }, { onConflict: 'user_id,provider' })
    .select('*')
    .single();
  return error ? fail<Integration>(error, 'Unable to save the integration.') : { data, error: null };
}

// ---------------------------------------------------------------------------
// Global search
// ---------------------------------------------------------------------------
export interface SearchResults {
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
  inboxItems: InboxItem[];
}

export async function globalSearch(db: DbClient, userId: string, term: string, limit = 5): Promise<Row<SearchResults>> {
  // Strip LIKE metacharacters so a term can never widen the match. A term made
  // only of wildcards or whitespace would otherwise leave the pattern as a bare
  // `%%`, which Postgres reads as "match everything".
  const cleaned = term.replace(/[%_,]/g, '').trim();
  if (cleaned === '') {
    return { data: { goals: [], projects: [], tasks: [], inboxItems: [] }, error: null };
  }
  const pattern = `%${cleaned}%`;
  const [goals, projects, tasks, inboxItems] = await Promise.all([
    db.from<Goal>('goals').select('*').eq('user_id', userId).ilike('title', pattern).limit(limit),
    db.from<Project>('projects').select('*').eq('user_id', userId).ilike('title', pattern).limit(limit),
    db.from<Task>('tasks').select('*').eq('user_id', userId).ilike('title', pattern).limit(limit),
    db.from<InboxItem>('inbox_items').select('*').eq('user_id', userId).or(`subject.ilike.${pattern},body.ilike.${pattern}`).limit(limit),
  ]);

  const firstError = goals.error ?? projects.error ?? tasks.error ?? inboxItems.error;
  if (firstError) return fail<SearchResults>(firstError, 'Search failed. Please try again.');

  return {
    data: {
      goals: goals.data ?? [],
      projects: projects.data ?? [],
      tasks: tasks.data ?? [],
      inboxItems: inboxItems.data ?? [],
    },
    error: null,
  };
}

export { DbFailure };
