/**
 * Health + risk engine.
 *
 * Project and goal health are computed from real records — never stored as
 * decorative numbers. The same code path runs in the API layer and in tests.
 */

import type { Goal, Project, ProjectMilestone, Task } from '../types';
import { daysUntil } from '../utils/dates';
import { rankTasks } from './priority';

export interface HealthResult {
  score: number;
  label: 'excellent' | 'good' | 'fair' | 'at_risk' | 'critical';
  reasons: string[];
  metrics: {
    totalTasks: number;
    completedTasks: number;
    openTasks: number;
    overdueTasks: number;
    dueSoonTasks: number;
    blockedTasks: number;
    progress: number;
    upcomingDeadlines: number;
    milestoneCompletion: number;
  };
}

export interface ProjectHealthInput {
  project: Project;
  tasks: Task[];
  milestones: ProjectMilestone[];
  now?: Date;
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function computeProjectHealth(input: ProjectHealthInput): HealthResult {
  const now = input.now ?? new Date();
  const { project, tasks, milestones } = input;

  const relevant = tasks.filter((task) => task.project_id === project.id && task.status !== 'cancelled');
  const totalTasks = relevant.length;
  const completedTasks = relevant.filter((task) => task.status === 'completed').length;
  const openTasks = relevant.filter((task) => task.status !== 'completed').length;
  const overdueTasks = relevant.filter(
    (task) => task.status !== 'completed' && task.due_date && (daysUntil(task.due_date, now) ?? 0) < 0,
  ).length;
  const dueSoonTasks = relevant.filter((task) => {
    if (task.status === 'completed' || !task.due_date) return false;
    const days = daysUntil(task.due_date, now);
    return days !== null && days >= 0 && days <= 3;
  }).length;
  const blockedTasks = relevant.filter((task) => task.status === 'blocked').length;

  const openMilestones = milestones.filter((milestone) => milestone.project_id === project.id);
  const completedMilestones = openMilestones.filter((milestone) => milestone.status === 'completed').length;
  const milestoneCompletion =
    openMilestones.length === 0 ? 100 : Math.round((completedMilestones / openMilestones.length) * 100);

  const progress = totalTasks === 0 ? milestoneCompletion : Math.round((completedTasks / totalTasks) * 100);

  const reasons: string[] = [];
  let score = 100;

  if (overdueTasks > 0) {
    score -= Math.min(40, overdueTasks * 12);
    reasons.push(`${overdueTasks} task${overdueTasks === 1 ? '' : 's'} ${overdueTasks === 1 ? 'is' : 'are'} overdue.`);
  }
  if (dueSoonTasks > 0) {
    score -= Math.min(18, dueSoonTasks * 6);
    reasons.push(`${dueSoonTasks} task${dueSoonTasks === 1 ? '' : 's'} due within 3 days.`);
  }
  if (blockedTasks > 0) {
    score -= Math.min(25, blockedTasks * 12);
    reasons.push(`${blockedTasks} task${blockedTasks === 1 ? '' : 's'} blocked.`);
  }
  // Concentration factor: when most of the open work is troubled, the project is
  // genuinely unhealthy even if each individual penalty looks survivable.
  if (openTasks > 0 && (overdueTasks + dueSoonTasks + blockedTasks) / openTasks >= 0.5) {
    score -= 15;
    reasons.push('Most of the open work is troubled.');
  }
  if (project.target_date) {
    const days = daysUntil(project.target_date, now);
    if (days !== null && days < 0) {
      score -= 20;
      reasons.push('The target date has passed.');
    } else if (days !== null && days <= 7 && progress < 80) {
      score -= 15;
      reasons.push(`Only ${days} day${days === 1 ? '' : 's'} left and progress is ${progress}%.`);
    }
  }
  if (project.status === 'blocked') {
    score -= 25;
    reasons.push('Project is marked blocked.');
  }
  if (totalTasks === 0 && openMilestones.length === 0) {
    reasons.push('No tasks yet — create tasks so VozPilot can track progress.');
  }
  if (progress === 100 && totalTasks > 0) {
    reasons.push('All tasks complete.');
  }
  if (reasons.length === 0) {
    reasons.push('On track. No overdue or blocked work.');
  }

  score = clamp(Math.round(score));

  return {
    score,
    label: score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : score >= 30 ? 'at_risk' : 'critical',
    reasons,
    metrics: {
      totalTasks,
      completedTasks,
      openTasks,
      overdueTasks,
      dueSoonTasks,
      blockedTasks,
      progress,
      upcomingDeadlines: dueSoonTasks,
      milestoneCompletion,
    },
  };
}

export interface GoalHealthInput {
  goal: Goal;
  projects: Project[];
  tasks: Task[];
  milestones: Array<{ id: string; goal_id: string; status: string; due_date: string | null }>;
  now?: Date;
}

export function computeGoalHealth(input: GoalHealthInput): HealthResult {
  const now = input.now ?? new Date();
  const { goal, projects, tasks, milestones } = input;

  const goalProjects = projects.filter((project) => project.goal_id === goal.id && project.status !== 'archived');
  const goalTasks = tasks.filter((task) => task.goal_id === goal.id && task.status !== 'cancelled');
  const goalMilestones = milestones.filter((milestone) => milestone.goal_id === goal.id);

  const totalTasks = goalTasks.length;
  const completedTasks = goalTasks.filter((task) => task.status === 'completed').length;
  const overdueTasks = goalTasks.filter(
    (task) => task.status !== 'completed' && task.due_date && (daysUntil(task.due_date, now) ?? 0) < 0,
  ).length;

  const avgProjectHealth =
    goalProjects.length === 0 ? 100 : Math.round(goalProjects.reduce((sum, project) => sum + project.health, 0) / goalProjects.length);

  const progress =
    goalMilestones.length > 0
      ? Math.round((goalMilestones.filter((m) => m.status === 'completed').length / goalMilestones.length) * 100)
      : totalTasks > 0
        ? Math.round((completedTasks / totalTasks) * 100)
        : 0;

  const reasons: string[] = [];
  let score = 100;

  if (overdueTasks > 0) {
    score -= Math.min(30, overdueTasks * 8);
    reasons.push(`${overdueTasks} linked task${overdueTasks === 1 ? '' : 's'} overdue.`);
  }
  if (goalProjects.length === 0) {
    score -= 15;
    reasons.push('No projects linked to this goal yet.');
  }
  if (avgProjectHealth < 60 && goalProjects.length > 0) {
    score -= 20;
    reasons.push('Linked projects are unhealthy.');
  }
  if (goal.target_date) {
    const days = daysUntil(goal.target_date, now);
    if (days !== null && days < 0 && goal.status !== 'completed') {
      score -= 25;
      reasons.push('Target date has passed.');
    } else if (days !== null && days <= 30 && progress < 50) {
      score -= 15;
      reasons.push(`Target date in ${days} days with only ${progress}% progress.`);
    }
  }
  if (goalMilestones.length > 0 && goalMilestones.every((m) => m.status === 'completed')) {
    reasons.push('All milestones complete.');
  }
  if (reasons.length === 0) reasons.push('Healthy — steady progress toward the target date.');

  score = clamp(Math.round(score));

  return {
    score,
    label: score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : score >= 30 ? 'at_risk' : 'critical',
    reasons,
    metrics: {
      totalTasks,
      completedTasks,
      openTasks: totalTasks - completedTasks,
      overdueTasks,
      dueSoonTasks: overdueTasks,
      blockedTasks: goalTasks.filter((task) => task.status === 'blocked').length,
      progress,
      upcomingDeadlines: 0,
      milestoneCompletion:
        goalMilestones.length === 0
          ? 0
          : Math.round((goalMilestones.filter((m) => m.status === 'completed').length / goalMilestones.length) * 100),
    },
  };
}

/** Top risk factors for a project, ordered by severity. */
export function projectRiskFactors(input: ProjectHealthInput): Array<{ severity: 'critical' | 'high' | 'medium'; message: string }> {
  const health = computeProjectHealth(input);
  const factors: Array<{ severity: 'critical' | 'high' | 'medium'; message: string }> = [];
  for (const reason of health.reasons) {
    if (/overdue|passed|blocked/i.test(reason)) factors.push({ severity: 'critical', message: reason });
    else if (/due within|days left/i.test(reason)) factors.push({ severity: 'high', message: reason });
    else factors.push({ severity: 'medium', message: reason });
  }
  return factors;
}

/** Aggregate workload snapshot for a single day. */
export function dailyWorkload(
  tasks: Task[],
  options: { now?: Date; availableMinutes?: number; blocksCount?: Map<string, number>; blockedTaskIds?: Set<string> } = {},
): { plannedMinutes: number; taskCount: number; availableMinutes: number; utilisation: number; overloaded: boolean } {
  const now = options.now ?? new Date();
  const ranked = rankTasks(tasks, { now, blocksCount: options.blocksCount, blockedTaskIds: options.blockedTaskIds });
  const plannedMinutes = ranked.reduce((sum, entry) => sum + (entry.task.estimated_minutes ?? 30), 0);
  const availableMinutes = options.availableMinutes ?? 480;
  const utilisation = availableMinutes === 0 ? 0 : Math.round((plannedMinutes / availableMinutes) * 100);
  return {
    plannedMinutes,
    taskCount: ranked.length,
    availableMinutes,
    utilisation,
    overloaded: utilisation > 110,
  };
}
