/**
 * VozCore tool registry.
 *
 * The LLM (or the local reasoning engine) can only *request* a tool call. Each
 * tool below:
 *   1. validates its arguments with Zod,
 *   2. is permission-checked by `evaluatePermission`,
 *   3. runs against the caller's own rows only,
 *   4. returns a structured result that is logged as an agent action.
 *
 * The model never receives raw database access.
 */

import { z } from 'zod';
import type { AgentName, Goal, Priority, Project, Task, TimeBlockKind } from '../types';
import type { DbClient } from '../db/client';
import * as repo from '../db/repositories';
import { blockedTaskIds, blockedByMap, dependencyMap } from '../db/repositories';
import { computeGoalHealth, computeProjectHealth } from '../engine/health';
import { buildDailyPlan } from '../engine/planner';
import { rankTasks, explainScore } from '../engine/priority';
import { analyzeInboxItem } from '../engine/inbox';
import { retrieveRelevantMemories, memoriesToPromptBlock } from '../engine/memory';
import { emitNotification, notify } from '../notifications/service';
import { startOfDay, addDays, formatTime } from '../utils/dates';

export interface ToolContext {
  db: DbClient;
  userId: string;
  runId: string | null;
  agent: AgentName;
  now: Date;
  timezone: string;
  confirmed: boolean;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
  entityType?: string;
  entityId?: string;
  error?: string;
  needsConfirmation?: boolean;
}

export interface ToolDefinition {
  name: string;
  agent: AgentName;
  description: string;
  schema: z.ZodTypeAny;
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}

const ok = (summary: string, data: unknown, entityType?: string, entityId?: string): ToolResult => ({
  ok: true,
  summary,
  data,
  entityType,
  entityId,
});

const err = (error: string): ToolResult => ({ ok: false, summary: error, error });

// ---------------------------------------------------------------------------
// Shared slot schemas
// ---------------------------------------------------------------------------
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const isoStamp = z.iso.datetime({ offset: true }).optional();
const prioritySchema = z.enum(['low', 'medium', 'high', 'critical']).optional();

/** Resolve "the ML task" / "ML task" against the user's real tasks. */
async function resolveTask(
  db: DbClient,
  userId: string,
  args: { task_id?: string; task_query?: string },
): Promise<{ task: Task | null; ambiguous: Task[] }> {
  if (args.task_id) {
    const result = await repo.getTask(db, userId, args.task_id);
    return { task: result.data, ambiguous: [] };
  }
  if (!args.task_query) return { task: null, ambiguous: [] };
  const { data } = await repo.listTasks(db, userId, { limit: 200 });
  const tasks = data ?? [];
  const needle = args.task_query.toLowerCase().trim();
  const scored = tasks
    .map((task) => {
      const title = task.title.toLowerCase();
      let score = 0;
      if (title === needle) score = 100;
      else if (title.includes(needle)) score = 85;
      else if (needle.includes(title) && title.length >= 3) score = 70;
      else {
        const tokens = needle.split(/\s+/).filter((token) => token.length > 2);
        const hits = tokens.filter((token) => title.includes(token)).length;
        score = tokens.length ? (hits / tokens.length) * 60 : 0;
      }
      return { task, score };
    })
    .filter((entry) => entry.score >= 40)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { task: null, ambiguous: [] };
  const best = scored[0].score;
  const tied = scored.filter((entry) => entry.score >= best - 6).map((entry) => entry.task);
  return { task: scored[0].task, ambiguous: tied.length > 1 ? tied : [] };
}

async function resolveProject(
  db: DbClient,
  userId: string,
  args: { project_id?: string; project_query?: string },
): Promise<Project | null> {
  if (args.project_id) {
    const result = await repo.getProject(db, userId, args.project_id);
    return result.data;
  }
  if (!args.project_query) return null;
  const { data } = await repo.listProjects(db, userId, true);
  const needle = args.project_query.toLowerCase().trim();
  return (
    (data ?? []).find((project) => project.title.toLowerCase() === needle) ??
    (data ?? []).find((project) => project.title.toLowerCase().includes(needle)) ??
    null
  );
}

async function resolveGoal(
  db: DbClient,
  userId: string,
  args: { goal_id?: string; goal_query?: string },
): Promise<Goal | null> {
  if (args.goal_id) {
    const result = await repo.getGoal(db, userId, args.goal_id);
    return result.data;
  }
  if (!args.goal_query) return null;
  const { data } = await repo.listGoals(db, userId, true);
  const needle = args.goal_query.toLowerCase().trim();
  return (
    (data ?? []).find((goal) => goal.title.toLowerCase() === needle) ??
    (data ?? []).find((goal) => goal.title.toLowerCase().includes(needle)) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Derived-metric maintenance: after any mutation, recompute the numbers that the
// UI shows so nothing on screen can drift from the database.
// ---------------------------------------------------------------------------
export async function refreshDerivedMetrics(
  db: DbClient,
  userId: string,
  scope: { projectId?: string | null; goalId?: string | null },
): Promise<void> {
  const tasksResult = await repo.listTasks(db, userId, { limit: 500 });
  const tasks = tasksResult.data ?? [];

  if (scope.projectId) {
    const projectResult = await repo.getProject(db, userId, scope.projectId);
    if (projectResult.data) {
      const milestones = await repo.listProjectMilestones(db, userId, scope.projectId);
      const health = computeProjectHealth({
        project: projectResult.data,
        tasks,
        milestones: milestones.data ?? [],
        now: new Date(),
      });
      const atRisk = health.score < 55 && projectResult.data.status !== 'completed' && projectResult.data.status !== 'archived';
      await repo.updateProject(db, userId, scope.projectId, {
        progress: health.metrics.progress,
        health: health.score,
        health_note: health.reasons[0] ?? '',
        risk: Math.max(0, 100 - health.score),
        status: atRisk && projectResult.data.status === 'active' ? 'at_risk' : projectResult.data.status,
      });
    }
  }

  if (scope.goalId) {
    const goalResult = await repo.getGoal(db, userId, scope.goalId);
    if (goalResult.data) {
      const projects = await repo.listProjects(db, userId, true);
      const milestones = await repo.listGoalMilestones(db, userId, scope.goalId);
      const health = computeGoalHealth({
        goal: goalResult.data,
        projects: projects.data ?? [],
        tasks,
        milestones: milestones.data ?? [],
        now: new Date(),
      });
      await repo.updateGoal(db, userId, scope.goalId, {
        progress: health.metrics.progress,
        health: health.score,
        health_note: health.reasons[0] ?? '',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const tools: ToolDefinition[] = [];

function define(tool: ToolDefinition): void {
  tools.push(tool);
}

// ---- Goals ----------------------------------------------------------------
define({
  name: 'create_goal',
  agent: 'vozgoal',
  description: 'Create a long-term goal for the user.',
  schema: z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    category: z.enum(['career', 'learning', 'health', 'finance', 'personal', 'project', 'general']).optional(),
    priority: prioritySchema,
    target_date: isoDate,
  }),
  async execute(ctx, args) {
    const parsed = z
      .object({
        title: z.string().min(1).max(200),
        description: z.string().max(5000).optional(),
        category: z.enum(['career', 'learning', 'health', 'finance', 'personal', 'project', 'general']).optional(),
        priority: prioritySchema,
        target_date: isoDate,
      })
      .safeParse(args);
    if (!parsed.success) return err('Invalid goal details.');
    const result = await repo.createGoal(ctx.db, ctx.userId, {
      title: parsed.data.title,
      description: parsed.data.description ?? '',
      category: parsed.data.category ?? 'general',
      priority: parsed.data.priority ?? 'medium',
      target_date: parsed.data.target_date ?? null,
    });
    if (result.error || !result.data) return err(result.error?.message ?? 'Could not create the goal.');
    await refreshDerivedMetrics(ctx.db, ctx.userId, { goalId: result.data.id });
    return ok(`Created goal "${result.data.title}"`, result.data, 'goal', result.data.id);
  },
});

define({
  name: 'update_goal',
  agent: 'vozgoal',
  description: 'Update an existing goal.',
  schema: z.object({
    goal_id: z.uuid().optional(),
    goal_query: z.string().optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    status: z.enum(['active', 'paused', 'completed', 'archived']).optional(),
    priority: prioritySchema,
    target_date: isoDate,
  }),
  async execute(ctx, args) {
    const goal = await resolveGoal(ctx.db, ctx.userId, args as never);
    if (!goal) return err('I could not find that goal.');
    const patch: Partial<Goal> = {};
    if (typeof args.title === 'string') patch.title = args.title;
    if (typeof args.description === 'string') patch.description = args.description;
    if (typeof args.status === 'string') patch.status = args.status as Goal['status'];
    if (typeof args.priority === 'string') patch.priority = args.priority as Priority;
    if (typeof args.target_date === 'string') patch.target_date = args.target_date;
    const result = await repo.updateGoal(ctx.db, ctx.userId, goal.id, patch);
    if (result.error || !result.data) return err(result.error?.message ?? 'Could not update the goal.');
    await refreshDerivedMetrics(ctx.db, ctx.userId, { goalId: goal.id });
    return ok(`Updated goal "${result.data.title}"`, result.data, 'goal', result.data.id);
  },
});

define({
  name: 'get_goal',
  agent: 'vozgoal',
  description: 'Read one goal with its milestones.',
  schema: z.object({ goal_id: z.uuid().optional(), goal_query: z.string().optional() }),
  async execute(ctx, args) {
    const goal = await resolveGoal(ctx.db, ctx.userId, args as never);
    if (!goal) return err('I could not find that goal.');
    const milestones = await repo.listGoalMilestones(ctx.db, ctx.userId, goal.id);
    return ok(`Goal "${goal.title}"`, { goal, milestones: milestones.data ?? [] }, 'goal', goal.id);
  },
});

define({
  name: 'list_goals',
  agent: 'vozgoal',
  description: 'List the user\'s goals.',
  schema: z.object({ include_completed: z.boolean().optional() }),
  async execute(ctx, args) {
    const goals = await repo.listGoals(ctx.db, ctx.userId, args.include_completed === true);
    return ok(`${goals.data?.length ?? 0} goal(s)`, goals.data ?? []);
  },
});

// ---- Projects -------------------------------------------------------------
define({
  name: 'create_project',
  agent: 'vozproject',
  description: 'Create a project, optionally linked to a goal.',
  schema: z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    goal_id: z.uuid().optional(),
    goal_query: z.string().optional(),
    status: z.enum(['planning', 'active', 'blocked', 'at_risk', 'completed', 'archived']).optional(),
    priority: prioritySchema,
    start_date: isoDate,
    target_date: isoDate,
  }),
  async execute(ctx, args) {
    const parsed = z
      .object({
        title: z.string().min(1).max(200),
        description: z.string().max(5000).optional(),
        goal_id: z.uuid().optional(),
        goal_query: z.string().optional(),
        status: z.enum(['planning', 'active', 'blocked', 'at_risk', 'completed', 'archived']).optional(),
        priority: prioritySchema,
        start_date: isoDate,
        target_date: isoDate,
      })
      .safeParse(args);
    if (!parsed.success) return err('Invalid project details.');
    const goal = parsed.data.goal_id ? { id: parsed.data.goal_id } : await resolveGoal(ctx.db, ctx.userId, parsed.data);
    const result = await repo.createProject(ctx.db, ctx.userId, {
      title: parsed.data.title,
      description: parsed.data.description ?? '',
      goal_id: goal?.id ?? null,
      status: parsed.data.status ?? 'planning',
      priority: parsed.data.priority ?? 'medium',
      start_date: parsed.data.start_date ?? null,
      target_date: parsed.data.target_date ?? null,
    });
    if (result.error || !result.data) return err(result.error?.message ?? 'Could not create the project.');
    if (result.data.goal_id) await refreshDerivedMetrics(ctx.db, ctx.userId, { goalId: result.data.goal_id });
    return ok(`Created project "${result.data.title}"`, result.data, 'project', result.data.id);
  },
});

define({
  name: 'update_project',
  agent: 'vozproject',
  description: 'Update a project, including its status.',
  schema: z.object({
    project_id: z.uuid().optional(),
    project_query: z.string().optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    status: z.enum(['planning', 'active', 'blocked', 'at_risk', 'completed', 'archived']).optional(),
    priority: prioritySchema,
    target_date: isoDate,
    notes: z.string().max(5000).optional(),
  }),
  async execute(ctx, args) {
    const project = await resolveProject(ctx.db, ctx.userId, args as never);
    if (!project) return err('I could not find that project.');
    const patch: Partial<Project> = {};
    if (typeof args.title === 'string') patch.title = args.title;
    if (typeof args.description === 'string') patch.description = args.description;
    if (typeof args.status === 'string') patch.status = args.status as Project['status'];
    if (typeof args.priority === 'string') patch.priority = args.priority as Priority;
    if (typeof args.target_date === 'string') patch.target_date = args.target_date;
    if (typeof args.notes === 'string') patch.notes = args.notes;
    const result = await repo.updateProject(ctx.db, ctx.userId, project.id, patch);
    if (result.error || !result.data) return err(result.error?.message ?? 'Could not update the project.');
    await refreshDerivedMetrics(ctx.db, ctx.userId, { projectId: project.id, goalId: project.goal_id });
    return ok(`Updated project "${result.data.title}"`, result.data, 'project', result.data.id);
  },
});

define({
  name: 'get_project',
  agent: 'vozproject',
  description: 'Read one project with milestones and tasks.',
  schema: z.object({ project_id: z.uuid().optional(), project_query: z.string().optional() }),
  async execute(ctx, args) {
    const project = await resolveProject(ctx.db, ctx.userId, args as never);
    if (!project) return err('I could not find that project.');
    const [milestones, tasks] = await Promise.all([
      repo.listProjectMilestones(ctx.db, ctx.userId, project.id),
      repo.listTasks(ctx.db, ctx.userId, { projectId: project.id, limit: 200 }),
    ]);
    return ok(`Project "${project.title}"`, { project, milestones: milestones.data ?? [], tasks: tasks.data ?? [] }, 'project', project.id);
  },
});

define({
  name: 'list_projects',
  agent: 'vozproject',
  description: 'List the user\'s projects.',
  schema: z.object({ include_completed: z.boolean().optional() }),
  async execute(ctx, args) {
    const projects = await repo.listProjects(ctx.db, ctx.userId, args.include_completed === true);
    return ok(`${projects.data?.length ?? 0} project(s)`, projects.data ?? []);
  },
});

// ---- Milestones -----------------------------------------------------------
define({
  name: 'create_milestone',
  agent: 'vozgoal',
  description: 'Create a milestone on a goal or a project.',
  schema: z.object({
    title: z.string().min(1).max(200),
    due_date: isoDate,
    project_id: z.uuid().optional(),
    project_query: z.string().optional(),
    goal_id: z.uuid().optional(),
    goal_query: z.string().optional(),
  }),
  async execute(ctx, args) {
    const project = await resolveProject(ctx.db, ctx.userId, args as never);
    const goal = await resolveGoal(ctx.db, ctx.userId, args as never);
    if (!project && !goal) return err('Tell me which goal or project the milestone belongs to.');
    const result = project
      ? await repo.createProjectMilestone(ctx.db, ctx.userId, {
          project_id: project.id,
          title: String(args.title),
          due_date: typeof args.due_date === 'string' ? args.due_date : null,
        })
      : await repo.createGoalMilestone(ctx.db, ctx.userId, {
          goal_id: goal!.id,
          title: String(args.title),
          due_date: typeof args.due_date === 'string' ? args.due_date : null,
        });
    if (result.error || !result.data) return err(result.error?.message ?? 'Could not create the milestone.');
    if (project) await refreshDerivedMetrics(ctx.db, ctx.userId, { projectId: project.id, goalId: project.goal_id });
    if (goal) await refreshDerivedMetrics(ctx.db, ctx.userId, { goalId: goal.id });
    return ok(`Created milestone "${result.data.title}"`, result.data, 'milestone', result.data.id);
  },
});

define({
  name: 'update_milestone',
  agent: 'vozgoal',
  description: 'Update a milestone status or due date.',
  schema: z.object({
    milestone_id: z.uuid(),
    title: z.string().min(1).max(200).optional(),
    due_date: isoDate,
    status: z.enum(['pending', 'in_progress', 'completed', 'missed']).optional(),
  }),
  async execute(ctx, args) {
    const milestones = await repo.listProjectMilestones(ctx.db, ctx.userId);
    const goalMilestones = await repo.listGoalMilestones(ctx.db, ctx.userId);
    const projectMilestone = (milestones.data ?? []).find((milestone) => milestone.id === args.milestone_id);
    const goalMilestone = (goalMilestones.data ?? []).find((milestone) => milestone.id === args.milestone_id);
    const patch: Record<string, unknown> = {};
    if (typeof args.title === 'string') patch.title = args.title;
    if (typeof args.due_date === 'string') patch.due_date = args.due_date;
    if (typeof args.status === 'string') {
      patch.status = args.status;
      patch.completed_at = args.status === 'completed' ? new Date().toISOString() : null;
    }
    if (projectMilestone) {
      const result = await repo.updateProjectMilestone(ctx.db, ctx.userId, projectMilestone.id, patch as never);
      if (result.error) return err(result.error.message);
      await refreshDerivedMetrics(ctx.db, ctx.userId, { projectId: projectMilestone.project_id });
      return ok(`Updated milestone "${projectMilestone.title}"`, result.data, 'milestone', projectMilestone.id);
    }
    if (goalMilestone) {
      const result = await repo.updateGoalMilestone(ctx.db, ctx.userId, goalMilestone.id, patch as never);
      if (result.error) return err(result.error.message);
      await refreshDerivedMetrics(ctx.db, ctx.userId, { goalId: goalMilestone.goal_id });
      return ok(`Updated milestone "${goalMilestone.title}"`, result.data, 'milestone', goalMilestone.id);
    }
    return err('I could not find that milestone.');
  },
});

// ---- Tasks ----------------------------------------------------------------
define({
  name: 'create_task',
  agent: 'vozproject',
  description: 'Create a task, optionally linked to a project, goal or milestone.',
  schema: z.object({
    title: z.string().min(1).max(300),
    description: z.string().max(5000).optional(),
    status: z.enum(['inbox', 'todo', 'in_progress', 'blocked', 'completed', 'cancelled']).optional(),
    priority: prioritySchema,
    due_date: isoStamp,
    estimated_minutes: z.number().int().min(1).max(1440).optional(),
    project_id: z.uuid().optional(),
    project_query: z.string().optional(),
    goal_id: z.uuid().optional(),
    goal_query: z.string().optional(),
    scheduled_date: isoDate,
    tags: z.array(z.string()).max(20).optional(),
    idempotency_key: z.string().max(120).optional(),
  }),
  async execute(ctx, args) {
    if (typeof args.idempotency_key === 'string') {
      const existing = await repo.listTasks(ctx.db, ctx.userId, { limit: 500 });
      const duplicate = (existing.data ?? []).find((task) => task.idempotency_key === args.idempotency_key);
      if (duplicate) {
        return ok(`Task "${duplicate.title}" already exists - no duplicate created.`, duplicate, 'task', duplicate.id);
      }
    }
    const project = await resolveProject(ctx.db, ctx.userId, args as never);
    const goal = await resolveGoal(ctx.db, ctx.userId, args as never);
    const result = await repo.createTask(ctx.db, ctx.userId, {
      title: String(args.title),
      description: typeof args.description === 'string' ? args.description : '',
      status: (args.status as Task['status']) ?? 'todo',
      priority: (args.priority as Priority) ?? 'medium',
      due_date: typeof args.due_date === 'string' ? args.due_date : null,
      estimated_minutes: typeof args.estimated_minutes === 'number' ? args.estimated_minutes : null,
      project_id: project?.id ?? null,
      goal_id: goal?.id ?? project?.goal_id ?? null,
      scheduled_date: typeof args.scheduled_date === 'string' ? args.scheduled_date : null,
      tags: Array.isArray(args.tags) ? (args.tags as string[]) : [],
      source: 'agent',
      idempotency_key: typeof args.idempotency_key === 'string' ? args.idempotency_key : null,
    });
    if (result.error || !result.data) return err(result.error?.message ?? 'Could not create the task.');
    await refreshDerivedMetrics(ctx.db, ctx.userId, { projectId: result.data.project_id, goalId: result.data.goal_id });
    return ok(`Created task "${result.data.title}"`, result.data, 'task', result.data.id);
  },
});

define({
  name: 'update_task',
  agent: 'vozday',
  description: 'Update a task: reschedule it, change priority, status or estimate.',
  schema: z.object({
    task_id: z.uuid().optional(),
    task_query: z.string().optional(),
    title: z.string().min(1).max(300).optional(),
    status: z.enum(['inbox', 'todo', 'in_progress', 'blocked', 'completed', 'cancelled']).optional(),
    priority: prioritySchema,
    due_date: isoStamp,
    scheduled_date: isoDate,
    estimated_minutes: z.number().int().min(1).max(1440).optional(),
    project_id: z.uuid().optional(),
    goal_id: z.uuid().optional(),
  }),
  async execute(ctx, args) {
    const { task, ambiguous } = await resolveTask(ctx.db, ctx.userId, args as never);
    if (!task) return err('I could not find that task.');
    if (ambiguous.length > 1) {
      return err(`Which task do you mean? Candidates: ${ambiguous.map((candidate) => `"${candidate.title}"`).join(', ')}`);
    }
    const patch: Partial<Task> = {};
    if (typeof args.title === 'string') patch.title = args.title;
    if (typeof args.status === 'string') patch.status = args.status as Task['status'];
    if (typeof args.priority === 'string') patch.priority = args.priority as Priority;
    if (typeof args.due_date === 'string') patch.due_date = args.due_date;
    if (typeof args.scheduled_date === 'string') patch.scheduled_date = args.scheduled_date;
    if (typeof args.estimated_minutes === 'number') patch.estimated_minutes = args.estimated_minutes;
    if (typeof args.project_id === 'string') patch.project_id = args.project_id;
    if (typeof args.goal_id === 'string') patch.goal_id = args.goal_id;
    const result = await repo.updateTask(ctx.db, ctx.userId, task.id, patch);
    if (result.error || !result.data) return err(result.error?.message ?? 'Could not update the task.');
    await refreshDerivedMetrics(ctx.db, ctx.userId, { projectId: result.data.project_id, goalId: result.data.goal_id });
    const moved = typeof args.due_date === 'string' && args.due_date !== task.due_date;
    return ok(
      moved
        ? `Moved "${result.data.title}" to ${new Date(result.data.due_date!).toISOString().slice(0, 10)}`
        : `Updated task "${result.data.title}"`,
      result.data,
      'task',
      result.data.id,
    );
  },
});

define({
  name: 'complete_task',
  agent: 'vozproject',
  description: 'Mark a task complete and record the actual duration.',
  schema: z.object({
    task_id: z.uuid().optional(),
    task_query: z.string().optional(),
    actual_minutes: z.number().int().min(0).max(10080).optional(),
  }),
  async execute(ctx, args) {
    const { task, ambiguous } = await resolveTask(ctx.db, ctx.userId, args as never);
    if (!task) return err('I could not find that task.');
    if (ambiguous.length > 1) {
      return err(`Which task do you mean? Candidates: ${ambiguous.map((candidate) => `"${candidate.title}"`).join(', ')}`);
    }
    const result = await repo.updateTask(ctx.db, ctx.userId, task.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      actual_minutes: typeof args.actual_minutes === 'number' ? args.actual_minutes : task.actual_minutes,
    });
    if (result.error || !result.data) return err(result.error?.message ?? 'Could not complete the task.');
    await refreshDerivedMetrics(ctx.db, ctx.userId, { projectId: result.data.project_id, goalId: result.data.goal_id });

    // Milestone completion is a real event worth surfacing.
    if (result.data.milestone_id) {
      const milestones = await repo.listProjectMilestones(ctx.db, ctx.userId, result.data.project_id ?? undefined);
      const milestone = (milestones.data ?? []).find((entry) => entry.id === result.data!.milestone_id);
      if (milestone) {
        const siblingTasks = await repo.listTasks(ctx.db, ctx.userId, { projectId: result.data!.project_id ?? undefined, limit: 300 });
        const allDone = (siblingTasks.data ?? []).filter((entry) => entry.milestone_id === milestone.id).every((entry) => entry.status === 'completed');
        if (allDone) {
          await repo.updateProjectMilestone(ctx.db, ctx.userId, milestone.id, { status: 'completed', completed_at: new Date().toISOString() });
        }
      }
    }

    return ok(`Completed task "${result.data.title}"`, result.data, 'task', result.data.id);
  },
});

define({
  name: 'get_task',
  agent: 'vozproject',
  description: 'Read one task.',
  schema: z.object({ task_id: z.uuid().optional(), task_query: z.string().optional() }),
  async execute(ctx, args) {
    const { task } = await resolveTask(ctx.db, ctx.userId, args as never);
    if (!task) return err('I could not find that task.');
    return ok(`Task "${task.title}"`, task, 'task', task.id);
  },
});

define({
  name: 'list_tasks',
  agent: 'vozproject',
  description: 'List tasks with optional filters (status, project, goal, overdue).',
  schema: z.object({
    status: z.enum(['inbox', 'todo', 'in_progress', 'blocked', 'completed', 'cancelled']).optional(),
    project_id: z.uuid().optional(),
    goal_id: z.uuid().optional(),
    overdue: z.boolean().optional(),
    include_completed: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  async execute(ctx, args) {
    const limit = typeof args.limit === 'number' ? args.limit : 100;
    let tasks = (await repo.listTasks(ctx.db, ctx.userId, { limit })).data ?? [];
    if (args.project_id) tasks = tasks.filter((task) => task.project_id === args.project_id);
    if (args.goal_id) tasks = tasks.filter((task) => task.goal_id === args.goal_id);
    if (args.status) tasks = tasks.filter((task) => task.status === args.status);
    if (args.include_completed === false) tasks = tasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled');
    if (args.overdue === true) {
      tasks = tasks.filter((task) => task.status !== 'completed' && task.due_date && new Date(task.due_date) < ctx.now);
    }
    return ok(`${tasks.length} task(s)`, tasks);
  },
});

define({
  name: 'delete_task',
  agent: 'vozproject',
  description: 'Permanently delete a task. Sensitive: requires explicit permission.',
  schema: z.object({ task_id: z.uuid().optional(), task_query: z.string().optional() }),
  async execute(ctx, args) {
    const { task } = await resolveTask(ctx.db, ctx.userId, args as never);
    if (!task) return err('I could not find that task.');
    const result = await repo.deleteTask(ctx.db, ctx.userId, task.id);
    if (result.error) return err(result.error.message);
    await refreshDerivedMetrics(ctx.db, ctx.userId, { projectId: task.project_id, goalId: task.goal_id });
    return ok(`Deleted task "${task.title}"`, { id: task.id }, 'task', task.id);
  },
});

// ---- Dependencies ---------------------------------------------------------
define({
  name: 'create_task_dependency',
  agent: 'vozproject',
  description: 'Make one task depend on another.',
  schema: z.object({
    task_id: z.uuid().optional(),
    task_query: z.string().optional(),
    depends_on_task_id: z.uuid().optional(),
    depends_on_query: z.string().optional(),
  }),
  async execute(ctx, args) {
    const first = await resolveTask(ctx.db, ctx.userId, { task_id: args.task_id as string, task_query: args.task_query as string });
    const second = await resolveTask(ctx.db, ctx.userId, {
      task_id: args.depends_on_task_id as string,
      task_query: args.depends_on_query as string,
    });
    if (!first.task || !second.task) return err('I could not match both tasks.');
    if (first.task.id === second.task.id) return err('A task cannot depend on itself.');
    const result = await repo.createDependency(ctx.db, ctx.userId, { task_id: first.task.id, depends_on_task_id: second.task.id });
    if (result.error) return err(result.error.message);
    return ok(`"${first.task.title}" now depends on "${second.task.title}"`, result.data, 'dependency', result.data?.id);
  },
});

define({
  name: 'remove_task_dependency',
  agent: 'vozproject',
  description: 'Remove a dependency between two tasks.',
  schema: z.object({
    dependency_id: z.uuid().optional(),
    task_id: z.uuid().optional(),
    depends_on_task_id: z.uuid().optional(),
  }),
  async execute(ctx, args) {
    const dependencies = (await repo.listDependencies(ctx.db, ctx.userId)).data ?? [];
    const match = dependencies.find(
      (dependency) =>
        (args.dependency_id && dependency.id === args.dependency_id) ||
        (args.task_id && args.depends_on_task_id && dependency.task_id === args.task_id && dependency.depends_on_task_id === args.depends_on_task_id),
    );
    if (!match) return err('I could not find that dependency.');
    const result = await repo.deleteDependency(ctx.db, ctx.userId, match.id);
    if (result.error) return err(result.error.message);
    return ok('Removed the dependency', { id: match.id });
  },
});

// ---- Daily plan / time blocks --------------------------------------------
define({
  name: 'create_daily_plan',
  agent: 'vozday',
  description: 'Build (or rebuild) the daily plan for a date using real tasks and commitments.',
  schema: z.object({ date: isoDate, force: z.boolean().optional() }),
  async execute(ctx, args) {
    const date = typeof args.date === 'string' ? args.date : ctx.now.toISOString().slice(0, 10);
    const preferences = (await repo.getPreferences(ctx.db, ctx.userId)).data;
    const timezone = ctx.timezone;
    const dayStart = new Date(`${date}T00:00:00Z`).toISOString();
    const dayEnd = new Date(`${date}T23:59:59Z`).toISOString();

    const [tasks, blocks, plan] = await Promise.all([
      repo.listTasks(ctx.db, ctx.userId, { limit: 300 }),
      repo.listTimeBlocks(ctx.db, ctx.userId, dayStart, dayEnd),
      repo.getDailyPlan(ctx.db, ctx.userId, date),
    ]);

    if (plan.data && args.force !== true) {
      return ok(`A plan already exists for ${date}. Ask me to rebuild it if you want it regenerated.`, plan.data, 'daily_plan', plan.data.id);
    }

    const allTasks = tasks.data ?? [];
    const dependencies = (await repo.listDependencies(ctx.db, ctx.userId)).data ?? [];
    const blocked = blockedTaskIds(allTasks, dependencies);
    const openTasks = allTasks.filter(
      (task) => task.status !== 'completed' && task.status !== 'cancelled' && !blocked.has(task.id),
    );

    const commitments = (blocks.data ?? []).filter((block) => block.kind === 'commitment');
    const built = buildDailyPlan({
      date,
      timezone,
      workdayStart: preferences?.workday_start ?? '09:00',
      workdayEnd: preferences?.workday_end ?? '21:00',
      breakMinutes: preferences?.break_minutes ?? 10,
      maxDailyBlocks: preferences?.max_daily_blocks ?? 6,
      tasks: openTasks,
      commitments,
      blockedTaskIds: blocked,
      now: ctx.now,
    });

    let planId = plan.data?.id ?? null;
    const saved = await repo.upsertDailyPlan(ctx.db, ctx.userId, {
      id: planId ?? undefined,
      plan_date: date,
      summary: built.summary,
      status: 'active',
      generated_by: 'agent',
    });
    if (saved.error || !saved.data) return err(saved.error?.message ?? 'Could not save the plan.');
    planId = saved.data.id;

    if (plan.data) await repo.deleteTimeBlocksForPlan(ctx.db, ctx.userId, planId);
    for (const block of built.blocks) {
      await repo.createTimeBlock(ctx.db, ctx.userId, {
        daily_plan_id: planId,
        task_id: block.task_id,
        title: block.title,
        start_at: block.start_at,
        end_at: block.end_at,
        kind: block.kind,
        status: 'planned',
        position: block.position,
      });
    }

    return ok(built.summary, { plan: saved.data, blocks: built.blocks, skipped: built.skipped }, 'daily_plan', planId);
  },
});

define({
  name: 'get_daily_plan',
  agent: 'vozday',
  description: 'Read the daily plan and time blocks for a date.',
  schema: z.object({ date: isoDate }),
  async execute(ctx, args) {
    const date = typeof args.date === 'string' ? args.date : ctx.now.toISOString().slice(0, 10);
    const plan = await repo.getDailyPlan(ctx.db, ctx.userId, date);
    const dayStart = new Date(`${date}T00:00:00Z`).toISOString();
    const dayEnd = new Date(`${date}T23:59:59Z`).toISOString();
    const blocks = await repo.listTimeBlocks(ctx.db, ctx.userId, dayStart, dayEnd);
    return ok(plan.data?.summary ?? 'No plan for this date yet.', { plan: plan.data, blocks: blocks.data ?? [] }, 'daily_plan', plan.data?.id);
  },
});

define({
  name: 'update_daily_plan',
  agent: 'vozday',
  description: 'Update the summary or status of a daily plan.',
  schema: z.object({ date: isoDate, summary: z.string().max(2000).optional(), status: z.enum(['draft', 'active', 'completed', 'archived']).optional() }),
  async execute(ctx, args) {
    const date = typeof args.date === 'string' ? args.date : ctx.now.toISOString().slice(0, 10);
    const plan = await repo.getDailyPlan(ctx.db, ctx.userId, date);
    if (!plan.data) return err('There is no plan for that date yet.');
    const patch: Record<string, unknown> = {};
    if (typeof args.summary === 'string') patch.summary = args.summary;
    if (typeof args.status === 'string') patch.status = args.status;
    const result = await repo.upsertDailyPlan(ctx.db, ctx.userId, { id: plan.data.id, plan_date: date, ...patch });
    if (result.error) return err(result.error.message);
    return ok('Updated the daily plan', result.data, 'daily_plan', plan.data.id);
  },
});

define({
  name: 'create_time_block',
  agent: 'vozday',
  description: 'Add a time block to the schedule.',
  schema: z.object({
    title: z.string().min(1).max(200),
    start_at: z.iso.datetime({ offset: true }),
    end_at: z.iso.datetime({ offset: true }),
    kind: z.enum(['focus', 'commitment', 'break', 'buffer', 'review']).optional(),
    task_id: z.uuid().optional(),
    task_query: z.string().optional(),
  }),
  async execute(ctx, args) {
    const { task } = await resolveTask(ctx.db, ctx.userId, { task_id: args.task_id as string, task_query: args.task_query as string });
    const result = await repo.createTimeBlock(ctx.db, ctx.userId, {
      title: String(args.title),
      start_at: String(args.start_at),
      end_at: String(args.end_at),
      kind: (args.kind as TimeBlockKind) ?? 'focus',
      task_id: task?.id ?? null,
    });
    if (result.error || !result.data) return err(result.error?.message ?? 'Could not create the time block.');
    return ok(`Scheduled "${result.data.title}" at ${formatTime(result.data.start_at, ctx.timezone)}`, result.data, 'time_block', result.data.id);
  },
});

define({
  name: 'update_time_block',
  agent: 'vozday',
  description: 'Move or update a time block.',
  schema: z.object({
    block_id: z.uuid(),
    start_at: z.iso.datetime({ offset: true }).optional(),
    end_at: z.iso.datetime({ offset: true }).optional(),
    title: z.string().min(1).max(200).optional(),
    status: z.enum(['planned', 'in_progress', 'completed', 'skipped', 'cancelled']).optional(),
  }),
  async execute(ctx, args) {
    const patch: Record<string, unknown> = {};
    if (typeof args.start_at === 'string') patch.start_at = args.start_at;
    if (typeof args.end_at === 'string') patch.end_at = args.end_at;
    if (typeof args.title === 'string') patch.title = args.title;
    if (typeof args.status === 'string') patch.status = args.status;
    const result = await repo.updateTimeBlock(ctx.db, ctx.userId, String(args.block_id), patch as never);
    if (result.error || !result.data) return err(result.error?.message ?? 'Could not update the time block.');
    return ok(`Moved "${result.data.title}" to ${formatTime(result.data.start_at, ctx.timezone)}`, result.data, 'time_block', result.data.id);
  },
});

// ---- Intelligence ---------------------------------------------------------
define({
  name: 'get_next_best_action',
  agent: 'vozcore',
  description: 'Compute the single best next action from real goals, projects, tasks and the plan.',
  schema: z.object({}),
  async execute(ctx) {
    const [goals, projects, tasks, dependencies] = await Promise.all([
      repo.listGoals(ctx.db, ctx.userId),
      repo.listProjects(ctx.db, ctx.userId),
      repo.listTasks(ctx.db, ctx.userId, { limit: 300 }),
      repo.listDependencies(ctx.db, ctx.userId),
    ]);

    const goalMap = new Map((goals.data ?? []).map((goal) => [goal.id, goal]));
    const projectMap = new Map((projects.data ?? []).map((project) => [project.id, project]));
    const blocks = blockedByMap(dependencies.data ?? []);
    const blocked = blockedTaskIds(tasks.data ?? [], dependencies.data ?? []);
    const open = (tasks.data ?? []).filter((task) => task.status !== 'completed' && task.status !== 'cancelled');
    const ranked = rankTasks(open, { now: ctx.now, goals: goalMap, projects: projectMap, blocksCount: blocks, blockedTaskIds: blocked });

    if (ranked.length === 0) {
      return ok('Nothing is waiting on you. Capture a goal or project and I will build the first plan.', {
        recommendation: null,
        openTaskCount: 0,
      });
    }

    const best = ranked[0];
    const alternatives = ranked.slice(1, 4).map((entry) => ({
      id: entry.task.id,
      title: entry.task.title,
      score: entry.score.total,
      estimated_minutes: entry.task.estimated_minutes,
    }));

    return ok(
      `Next best action: ${best.task.title}`,
      {
        recommendation: {
          task_id: best.task.id,
          title: best.task.title,
          priority: best.task.priority,
          estimated_minutes: best.task.estimated_minutes,
          due_date: best.task.due_date,
          project: best.task.project_id ? projectMap.get(best.task.project_id)?.title ?? null : null,
          goal: best.task.goal_id ? goalMap.get(best.task.goal_id)?.title ?? null : null,
          score: best.score,
          reason: explainScore(best.score),
          blocks_count: blocks.get(best.task.id) ?? 0,
        },
        alternatives,
        openTaskCount: open.length,
        overdueCount: open.filter((task) => task.due_date && new Date(task.due_date) < ctx.now).length,
      },
      'task',
      best.task.id,
    );
  },
});

define({
  name: 'get_project_health',
  agent: 'vozproject',
  description: 'Compute health and risk for one or all projects.',
  schema: z.object({ project_id: z.uuid().optional(), project_query: z.string().optional() }),
  async execute(ctx, args) {
    const [projects, tasks, milestones] = await Promise.all([
      repo.listProjects(ctx.db, ctx.userId, true),
      repo.listTasks(ctx.db, ctx.userId, { limit: 500 }),
      repo.listProjectMilestones(ctx.db, ctx.userId),
    ]);
    let targets = projects.data ?? [];
    if (args.project_id || args.project_query) {
      const project = await resolveProject(ctx.db, ctx.userId, args as never);
      targets = project ? [project] : [];
    }
    const report = targets.map((project) => {
      const health = computeProjectHealth({
        project,
        tasks: tasks.data ?? [],
        milestones: (milestones.data ?? []).filter((milestone) => milestone.project_id === project.id),
        now: ctx.now,
      });
      return { project, health };
    });
    return ok(`Health computed for ${report.length} project(s)`, report);
  },
});

define({
  name: 'get_goal_health',
  agent: 'vozgoal',
  description: 'Compute health and progress for one or all goals.',
  schema: z.object({ goal_id: z.uuid().optional(), goal_query: z.string().optional() }),
  async execute(ctx, args) {
    const [goals, projects, tasks, milestones] = await Promise.all([
      repo.listGoals(ctx.db, ctx.userId, true),
      repo.listProjects(ctx.db, ctx.userId, true),
      repo.listTasks(ctx.db, ctx.userId, { limit: 500 }),
      repo.listGoalMilestones(ctx.db, ctx.userId),
    ]);
    let targets = goals.data ?? [];
    if (args.goal_id || args.goal_query) {
      const goal = await resolveGoal(ctx.db, ctx.userId, args as never);
      targets = goal ? [goal] : [];
    }
    const report = targets.map((goal) => ({
      goal,
      health: computeGoalHealth({
        goal,
        projects: projects.data ?? [],
        tasks: tasks.data ?? [],
        milestones: (milestones.data ?? []).filter((milestone) => milestone.goal_id === goal.id),
        now: ctx.now,
      }),
    }));
    return ok(`Health computed for ${report.length} goal(s)`, report);
  },
});

define({
  name: 'get_daily_workload',
  agent: 'vozday',
  description: 'Report planned versus available minutes for a date.',
  schema: z.object({ date: isoDate }),
  async execute(ctx, args) {
    const date = typeof args.date === 'string' ? args.date : ctx.now.toISOString().slice(0, 10);
    const preferences = (await repo.getPreferences(ctx.db, ctx.userId)).data;
    const dayStart = new Date(`${date}T00:00:00Z`).toISOString();
    const dayEnd = new Date(`${date}T23:59:59Z`).toISOString();
    const [tasks, blocks] = await Promise.all([
      repo.listTasks(ctx.db, ctx.userId, { limit: 300 }),
      repo.listTimeBlocks(ctx.db, ctx.userId, dayStart, dayEnd),
    ]);
    const available =
      ((blocks.data ?? []).filter((block) => block.kind !== 'commitment').reduce(
        (sum, block) => sum + Math.max(0, (new Date(block.end_at).getTime() - new Date(block.start_at).getTime()) / 60000),
        0,
      ) || 480);
    const open = (tasks.data ?? []).filter((task) => task.status !== 'completed' && task.status !== 'cancelled');
    const planned = open.reduce((sum, task) => sum + (task.estimated_minutes ?? 30), 0);
    return ok(`Workload for ${date}`, {
      date,
      plannedMinutes: planned,
      availableMinutes: Math.round(available),
      utilisation: Math.round((planned / Math.max(1, available)) * 100),
      overloaded: planned > available,
      openTaskCount: open.length,
      workday: { start: preferences?.workday_start ?? '09:00', end: preferences?.workday_end ?? '21:00' },
    });
  },
});

define({
  name: 'get_user_context',
  agent: 'vozcore',
  description: 'Return a compact snapshot of the user\'s goals, projects, tasks, plan and notifications.',
  schema: z.object({}),
  async execute(ctx) {
    const [goals, projects, tasks, notifications] = await Promise.all([
      repo.listGoals(ctx.db, ctx.userId),
      repo.listProjects(ctx.db, ctx.userId),
      repo.listTasks(ctx.db, ctx.userId, { limit: 200 }),
      repo.listNotifications(ctx.db, ctx.userId, { limit: 10 }),
    ]);
    const open = (tasks.data ?? []).filter((task) => task.status !== 'completed' && task.status !== 'cancelled');
    return ok('Context snapshot', {
      goals: (goals.data ?? []).map((goal) => ({ id: goal.id, title: goal.title, status: goal.status, progress: goal.progress, health: goal.health })),
      projects: (projects.data ?? []).map((project) => ({
        id: project.id,
        title: project.title,
        status: project.status,
        progress: project.progress,
        health: project.health,
      })),
      openTasks: open.length,
      overdueTasks: open.filter((task) => task.due_date && new Date(task.due_date) < ctx.now).length,
      unreadNotifications: (notifications.data ?? []).filter((notification) => !notification.read_at).length,
    });
  },
});

// ---- Notifications --------------------------------------------------------
define({
  name: 'create_notification',
  agent: 'vozcore',
  description: 'Create a web notification for the user.',
  schema: z.object({
    type: z.enum([
      'deadline_approaching', 'task_overdue', 'project_at_risk', 'goal_milestone', 'inbox_action',
      'daily_briefing', 'schedule_conflict', 'next_task', 'agent_action', 'system',
    ]),
    title: z.string().min(1).max(200),
    body: z.string().max(2000).optional(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  }),
  async execute(ctx, args) {
    const preferences = (await repo.getPreferences(ctx.db, ctx.userId)).data;
    const result = await emitNotification(
      ctx.db,
      ctx.userId,
      {
        type: args.type as never,
        title: String(args.title),
        body: typeof args.body === 'string' ? args.body : '',
        priority: (args.priority as never) ?? 'medium',
      },
      preferences,
    );
    if (!result.created) return ok(`Notification suppressed (${result.skipped ?? 'unknown'}).`, { suppressed: result.skipped });
    return ok(`Notification created: "${result.created.title}"`, result.created, 'notification', result.created.id);
  },
});

define({
  name: 'list_notifications',
  agent: 'vozcore',
  description: 'List the user\'s recent notifications.',
  schema: z.object({ limit: z.number().int().min(1).max(50).optional(), unread_only: z.boolean().optional() }),
  async execute(ctx, args) {
    const notifications = await repo.listNotifications(ctx.db, ctx.userId, {
      limit: (args.limit as number) ?? 10,
      unreadOnly: args.unread_only === true,
    });
    return ok(`${notifications.data?.length ?? 0} notification(s)`, notifications.data ?? []);
  },
});

define({
  name: 'mark_notification_read',
  agent: 'vozcore',
  description: 'Mark one notification (or all) as read.',
  schema: z.object({ notification_id: z.uuid().optional() }),
  async execute(ctx, args) {
    if (typeof args.notification_id === 'string') {
      const result = await repo.markNotificationRead(ctx.db, ctx.userId, args.notification_id);
      if (result.error) return err(result.error.message);
      return ok('Notification marked as read.', result.data);
    }
    await repo.markAllNotificationsRead(ctx.db, ctx.userId);
    return ok('All notifications marked as read.', {});
  },
});

// ---- Memory ---------------------------------------------------------------
define({
  name: 'create_memory',
  agent: 'vozcore',
  description: 'Store a durable fact about the user for future context.',
  schema: z.object({
    content: z.string().min(1).max(2000),
    category: z.enum([
      'user_preferences', 'goals', 'projects', 'working_style', 'recurring_patterns',
      'important_context', 'completed_milestones', 'historical_decisions',
    ]).optional(),
    importance: z.number().int().min(0).max(100).optional(),
  }),
  async execute(ctx, args) {
    const existing = (await repo.listMemories(ctx.db, ctx.userId)).data ?? [];
    const { isDuplicateMemory } = await import('../engine/memory');
    if (isDuplicateMemory(existing, String(args.content))) {
      return ok('I already have that noted.', { duplicate: true });
    }
    const result = await repo.createMemory(ctx.db, ctx.userId, {
      content: String(args.content),
      category: (args.category as never) ?? 'important_context',
      importance: typeof args.importance === 'number' ? args.importance : 50,
      source: 'agent',
    });
    if (result.error || !result.data) return err(result.error?.message ?? 'Could not save the memory.');
    return ok('Remembered.', result.data, 'memory', result.data.id);
  },
});

define({
  name: 'retrieve_memory',
  agent: 'vozcore',
  description: 'Retrieve memories relevant to a query.',
  schema: z.object({ query: z.string().max(500).optional(), limit: z.number().int().min(1).max(20).optional() }),
  async execute(ctx, args) {
    const memories = (await repo.listMemories(ctx.db, ctx.userId)).data ?? [];
    const retrieved = retrieveRelevantMemories(memories, {
      query: typeof args.query === 'string' ? args.query : '',
      limit: (args.limit as number) ?? 8,
      now: ctx.now,
    });
    return ok(`${retrieved.length} relevant memor${retrieved.length === 1 ? 'y' : 'ies'}`, {
      retrieved: retrieved.map((entry) => ({ id: entry.memory.id, category: entry.memory.category, content: entry.memory.content, score: entry.score })),
      promptBlock: memoriesToPromptBlock(retrieved),
    });
  },
});

// ---- Agent activity -------------------------------------------------------
define({
  name: 'list_agent_activity',
  agent: 'vozcore',
  description: 'List recent agent actions for the audit trail.',
  schema: z.object({ agent: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }),
  async execute(ctx, args) {
    const actions = await repo.listAgentActions(ctx.db, ctx.userId, {
      agent: typeof args.agent === 'string' ? args.agent : undefined,
      limit: (args.limit as number) ?? 20,
    });
    return ok(`${actions.data?.length ?? 0} action(s)`, actions.data ?? []);
  },
});

// ---- Inbox ----------------------------------------------------------------
define({
  name: 'analyze_inbox_item',
  agent: 'vozinbox',
  description: 'Analyse an inbox item: intent, deadline, actions, priority and matches.',
  schema: z.object({ inbox_item_id: z.uuid().optional() }),
  async execute(ctx, args) {
    let item = null as Awaited<ReturnType<typeof repo.getInboxItem>>['data'];
    if (typeof args.inbox_item_id === 'string') {
      item = (await repo.getInboxItem(ctx.db, ctx.userId, args.inbox_item_id)).data;
    } else {
      const items = await repo.listInboxItems(ctx.db, ctx.userId, ['new']);
      item = items.data?.[0] ?? null;
    }
    if (!item) return err('There is no unread inbox item to analyse.');

    const [projects, goals] = await Promise.all([
      repo.listProjects(ctx.db, ctx.userId),
      repo.listGoals(ctx.db, ctx.userId),
    ]);
    const analysis = analyzeInboxItem({
      subject: item.subject,
      body: item.body,
      sender: item.sender,
      projects: projects.data ?? [],
      goals: goals.data ?? [],
      now: ctx.now,
    });

    const updated = await repo.updateInboxItem(ctx.db, ctx.userId, item.id, {
      status: 'analyzed',
      analysis,
      matched_project_id: analysis.matched_project_id,
      matched_goal_id: analysis.matched_goal_id,
    });
    if (updated.error) return err(updated.error.message);

    // Suggested actions are stored but NOT executed - the user confirms first.
    for (const action of analysis.actions) {
      await repo.createInboxAction(ctx.db, ctx.userId, {
        inbox_item_id: item.id,
        kind: action.kind,
        title: action.title,
        due_date: action.due_date,
        priority: action.priority,
        project_id: analysis.matched_project_id,
        goal_id: analysis.matched_goal_id,
        confidence: action.confidence,
        status: 'suggested',
      });
    }

    const preferences = (await repo.getPreferences(ctx.db, ctx.userId)).data;
    await emitNotification(ctx.db, ctx.userId, notify.inboxAction(analysis.summary, item.id), preferences, { now: ctx.now });

    return ok(
      `Analysed "${analysis.summary}" - ${analysis.actions.length} suggested action(s), confidence ${Math.round(analysis.confidence * 100)}%`,
      { item: updated.data, analysis },
      'inbox_item',
      item.id,
    );
  },
});

define({
  name: 'create_action_from_inbox',
  agent: 'vozinbox',
  description: 'Turn a suggested inbox action into a real task.',
  schema: z.object({
    inbox_item_id: z.uuid(),
    title: z.string().min(1).max(300),
    kind: z.enum(['task', 'reminder', 'event', 'follow_up', 'deadline']).optional(),
    due_date: z.iso.datetime({ offset: true }).optional(),
    priority: prioritySchema,
    project_id: z.uuid().optional(),
    goal_id: z.uuid().optional(),
    estimated_minutes: z.number().int().min(1).max(1440).optional(),
  }),
  async execute(ctx, args) {
    const item = (await repo.getInboxItem(ctx.db, ctx.userId, String(args.inbox_item_id))).data;
    if (!item) return err('That inbox item no longer exists.');
    const task = await repo.createTask(ctx.db, ctx.userId, {
      title: String(args.title),
      status: 'todo',
      priority: (args.priority as Priority) ?? 'medium',
      due_date: typeof args.due_date === 'string' ? args.due_date : null,
      estimated_minutes: typeof args.estimated_minutes === 'number' ? args.estimated_minutes : null,
      project_id: (args.project_id as string) ?? item.matched_project_id,
      goal_id: (args.goal_id as string) ?? item.matched_goal_id,
      source: 'inbox',
    });
    if (task.error || !task.data) return err(task.error?.message ?? 'Could not create the task.');
    await repo.updateInboxItem(ctx.db, ctx.userId, item.id, { status: 'actioned' });
    await refreshDerivedMetrics(ctx.db, ctx.userId, { projectId: task.data.project_id, goalId: task.data.goal_id });
    return ok(`Created task "${task.data.title}" from inbox item`, { task: task.data }, 'task', task.data.id);
  },
});

// ---- Sensitive: bulk planning --------------------------------------------
define({
  name: 'plan_goal_breakdown',
  agent: 'vozgoal',
  description: 'Break a goal into milestones, a project and starter tasks. Sensitive: creates many records.',
  schema: z.object({
    goal_id: z.uuid().optional(),
    goal_query: z.string().optional(),
    title: z.string().max(200).optional(),
  }),
  async execute(ctx, args) {
    const goal = await resolveGoal(ctx.db, ctx.userId, args as never);
    if (!goal) return err('I could not find that goal.');

    const permissions = (await repo.getPermissions(ctx.db, ctx.userId)).data;
    if (permissions && (permissions.create_milestones === false || permissions.create_tasks === false)) {
      return err('Goal breakdown needs "Create tasks" and "Create milestones" enabled in Settings > AI permissions.');
    }

    const existingMilestones = (await repo.listGoalMilestones(ctx.db, ctx.userId, goal.id)).data ?? [];
    const existingProjects = (await repo.listProjects(ctx.db, ctx.userId, true)).data ?? [];
    const hasProject = existingProjects.some((project) => project.goal_id === goal.id);

    const project = hasProject
      ? existingProjects.find((entry) => entry.goal_id === goal.id)!
      : (await repo.createProject(ctx.db, ctx.userId, {
          title: `${goal.title} - execution`,
          goal_id: goal.id,
          status: 'active',
          priority: goal.priority,
          target_date: goal.target_date,
        })).data;

    const created: string[] = [];
    const milestoneTitles = deriveMilestones(goal.title);
    for (const [index, title] of milestoneTitles.entries()) {
      if (existingMilestones.some((milestone) => milestone.title === title)) continue;
      const milestone = await repo.createGoalMilestone(ctx.db, ctx.userId, {
        goal_id: goal.id,
        title,
        position: existingMilestones.length + index,
        due_date: goal.target_date,
      });
      if (milestone.data) created.push(`milestone "${title}"`);
    }

    const starterTasks = deriveStarterTasks(goal.title);
    for (const title of starterTasks) {
      const result = await repo.createTask(ctx.db, ctx.userId, {
        title,
        goal_id: goal.id,
        project_id: project?.id ?? null,
        status: 'todo',
        priority: 'medium',
        estimated_minutes: 45,
        source: 'agent',
      });
      if (result.data) created.push(`task "${title}"`);
    }

    await refreshDerivedMetrics(ctx.db, ctx.userId, { goalId: goal.id, projectId: project?.id });

    const preferences = (await repo.getPreferences(ctx.db, ctx.userId)).data;
    await emitNotification(ctx.db, ctx.userId, notify.goalMilestone(goal.title, goal.id), preferences, { now: ctx.now });

    return ok(
      `Broke "${goal.title}" into ${created.length} records (${milestoneTitles.length} milestones, ${starterTasks.length} tasks).`,
      { goal, project, created },
      'goal',
      goal.id,
    );
  },
});

/** Deterministic milestone decomposition derived from the goal wording. */
export function deriveMilestones(goalTitle: string): string[] {
  const base = goalTitle.replace(/\s+/g, ' ').trim();
  return [
    `Define what "${base}" means concretely`,
    `Gather the resources needed for "${base}"`,
    `Build the first working version toward "${base}"`,
    `Review progress and close the gaps for "${base}"`,
  ];
}

export function deriveStarterTasks(goalTitle: string): string[] {
  const base = goalTitle.replace(/\s+/g, ' ').trim();
  return [
    `Write the success criteria for "${base}"`,
    `Block the first 90-minute focus session for "${base}"`,
    `List the three biggest unknowns for "${base}"`,
  ];
}

// ---------------------------------------------------------------------------
export const TOOLS: ToolDefinition[] = tools;

export function getTool(name: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.name === name);
}

export function toolNames(): string[] {
  return tools.map((tool) => tool.name);
}

export function toolSpecs() {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: { type: 'object' as const, properties: {}, required: [] as string[] },
  }));
}

export { startOfDay, addDays, dependencyMap };
