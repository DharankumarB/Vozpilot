/**
 * Priority scoring engine.
 *
 * Deterministic, explainable scoring. VozCore uses the resulting score plus the
 * per-factor breakdown to justify its recommendations — the numbers are never
 * invented, they are computed from real task/project/goal records.
 */

import type { Goal, Priority, Project, Task } from '../types';
import { daysUntil } from '../utils/dates';

export interface PriorityBreakdown {
  deadlineUrgency: number;
  importance: number;
  goalRelevance: number;
  projectRisk: number;
  dependencyImpact: number;
  effortFit: number;
  overdue: number;
  total: number;
}

export interface PriorityInput {
  task: Task;
  now?: Date;
  goals?: Map<string, Goal>;
  projects?: Map<string, Project>;
  /** task_id -> number of tasks blocked by it */
  blocksCount?: Map<string, number>;
  /** task_ids that still have unfinished dependencies */
  blockedTaskIds?: Set<string>;
}

const PRIORITY_WEIGHT: Record<Priority, number> = {
  critical: 20,
  high: 14,
  medium: 8,
  low: 3,
};

const MAX_DEADLINE_POINTS = 30;
const MAX_OVERDUE_POINTS = 20;
const MAX_DEPENDENCY_POINTS = 15;
const MAX_PROJECT_RISK_POINTS = 15;
const MAX_EFFORT_POINTS = 6;

/** 0..1 urgency curve: 1 when due/overdue, decaying over 14 days. */
export function deadlineUrgency(dueDate: string | null, now: Date = new Date()): number {
  if (!dueDate) return 0;
  const days = daysUntil(dueDate, now);
  if (days === null) return 0;
  if (days <= 0) return 1;
  if (days >= 14) return 0;
  return 1 - days / 14;
}

/** Blocked tasks can never be the "next best action". */
export function isBlocked(task: Task, blockedTaskIds?: Set<string>): boolean {
  if (task.status === 'blocked') return true;
  if (task.status === 'completed' || task.status === 'cancelled') return true;
  return blockedTaskIds ? blockedTaskIds.has(task.id) : false;
}

export function scorePriority(input: PriorityInput): PriorityBreakdown {
  const now = input.now ?? new Date();
  const { task } = input;

  const urgency = deadlineUrgency(task.due_date, now);
  const deadlineUrgencyPoints = Math.round(urgency * MAX_DEADLINE_POINTS);

  const importance = PRIORITY_WEIGHT[task.priority] ?? 8;

  const goal = task.goal_id ? input.goals?.get(task.goal_id) : undefined;
  const goalRelevance = goal ? Math.round(PRIORITY_WEIGHT[goal.priority] * 0.5) : 0;

  const project = task.project_id ? input.projects?.get(task.project_id) : undefined;
  const projectRisk = project ? Math.round((project.risk / 100) * MAX_PROJECT_RISK_POINTS) : 0;

  const blocks = input.blocksCount?.get(task.id) ?? 0;
  const dependencyImpact = Math.min(MAX_DEPENDENCY_POINTS, blocks * 5);

  const estimate = task.estimated_minutes;
  // Quick wins (<30m) get a small boost; very long tasks are slightly deprioritised
  // so a single 6h item does not crowd out everything else.
  let effortFit = 0;
  if (estimate) {
    if (estimate <= 30) effortFit = MAX_EFFORT_POINTS;
    else if (estimate <= 60) effortFit = 4;
    else if (estimate <= 120) effortFit = 2;
    else if (estimate <= 240) effortFit = 0;
    else effortFit = -2;
  }

  const days = task.due_date ? daysUntil(task.due_date, now) : null;
  const overduePoints = days !== null && days < 0 ? Math.min(MAX_OVERDUE_POINTS, 10 + Math.min(10, Math.abs(days))) : 0;

  const total = Math.max(
    0,
    deadlineUrgencyPoints + importance + goalRelevance + projectRisk + dependencyImpact + effortFit + overduePoints,
  );

  return {
    deadlineUrgency: deadlineUrgencyPoints,
    importance,
    goalRelevance,
    projectRisk,
    dependencyImpact,
    effortFit,
    overdue: overduePoints,
    total,
  };
}

/** Rank open tasks best-first, with a deterministic tie-break on id. */
export function rankTasks(
  tasks: Task[],
  options: {
    now?: Date;
    goals?: Map<string, Goal>;
    projects?: Map<string, Project>;
    blocksCount?: Map<string, number>;
    blockedTaskIds?: Set<string>;
  } = {},
): Array<{ task: Task; score: PriorityBreakdown }> {
  return tasks
    .filter((task) => !isBlocked(task, options.blockedTaskIds))
    .map((task) => ({ task, score: scorePriority({ task, ...options }) }))
    .sort((a, b) => {
      if (b.score.total !== a.score.total) return b.score.total - a.score.total;
      const ad = a.task.due_date ?? '9999';
      const bd = b.task.due_date ?? '9999';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return a.task.id.localeCompare(b.task.id);
    });
}

/** Short natural-language explanation of why a task scored the way it did. */
export function explainScore(breakdown: PriorityBreakdown): string {
  const reasons: string[] = [];
  if (breakdown.overdue > 0) reasons.push('it is overdue');
  if (breakdown.deadlineUrgency >= 20) reasons.push('the deadline is imminent');
  else if (breakdown.deadlineUrgency >= 10) reasons.push('the deadline is close');
  if (breakdown.importance >= 14) reasons.push('it is high importance');
  if (breakdown.projectRisk >= 8) reasons.push('its project is at risk');
  if (breakdown.dependencyImpact > 0) reasons.push('other tasks are waiting on it');
  if (breakdown.goalRelevance >= 7) reasons.push('it directly advances a top goal');
  if (breakdown.effortFit >= 4) reasons.push('it is a quick win');
  if (reasons.length === 0) return 'it is the highest-value available work right now';
  return reasons.join(', ');
}
