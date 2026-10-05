/**
 * Daily briefing builder.
 *
 * Every figure rendered on the dashboard comes from this function, which reads
 * real records. There are no hardcoded statistics anywhere in the product.
 */

import { daysUntil, formatTime } from '../utils/dates';
import type { Goal, Notification, Project, Task, TimeBlock } from '../types';
import { rankTasks } from './priority';
import { computeGoalHealth, computeProjectHealth } from './health';

export interface BriefingSection {
  id: string;
  kind: 'priority' | 'project' | 'goal' | 'schedule' | 'risk' | 'inbox';
  label: string;
  title: string;
  detail: string;
  entityType: 'task' | 'project' | 'goal' | 'plan' | null;
  entityId: string | null;
  actionUrl: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface DailyBriefing {
  greeting: string;
  headline: string;
  dateLabel: string;
  sections: BriefingSection[];
  metrics: {
    activeGoals: number;
    activeProjects: number;
    tasksDueToday: number;
    overdueTasks: number;
    completedToday: number;
    focusBlocks: number;
    plannedMinutes: number;
    unreadNotifications: number;
  };
}

export interface BriefingInput {
  now: Date;
  timezone: string;
  displayName: string;
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
  blocks: TimeBlock[];
  notifications: Notification[];
  goalMilestones: Array<{ id: string; goal_id: string; status: string; due_date: string | null }>;
  projectMilestones: Array<{ id: string; project_id: string; status: string; due_date: string | null }>;
  inboxPending: number;
}

export function greetingForHour(hour: number): string {
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function buildDailyBriefing(input: BriefingInput): DailyBriefing {
  const { now, timezone, goals, projects, tasks, blocks, notifications } = input;

  const openTasks = tasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled');
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

  const dueToday = openTasks.filter((task) => task.due_date && dateKey(task.due_date, timezone) === todayKey);
  const overdue = openTasks.filter((task) => task.due_date && (daysUntil(task.due_date, now) ?? 0) < 0);
  const completedToday = tasks.filter(
    (task) => task.completed_at && dateKey(task.completed_at, timezone) === todayKey,
  ).length;

  const ranked = rankTasks(openTasks, { now });
  const sections: BriefingSection[] = [];

  for (const entry of ranked.slice(0, 3)) {
    const task = entry.task;
    sections.push({
      id: `task-${task.id}`,
      kind: 'priority',
      label: task.priority === 'critical' ? 'CRITICAL' : task.priority === 'high' ? 'HIGH' : 'PRIORITY',
      title: task.title,
      detail: describeTask(task, now),
      entityType: 'task',
      entityId: task.id,
      actionUrl: '/tasks',
      severity: task.priority === 'critical' ? 'critical' : task.priority === 'high' ? 'high' : 'medium',
    });
  }

  for (const project of projects) {
    if (project.status === 'archived' || project.status === 'completed') continue;
    const health = computeProjectHealth({
      project,
      tasks,
      milestones: input.projectMilestones as never,
      now,
    });
    if (health.score < 70) {
      sections.push({
        id: `project-${project.id}`,
        kind: 'risk',
        label: 'RISK',
        title: project.title,
        detail: health.reasons[0] ?? 'Project needs attention.',
        entityType: 'project',
        entityId: project.id,
        actionUrl: `/projects/${project.id}`,
        severity: health.score < 45 ? 'critical' : 'high',
      });
    }
  }

  for (const goal of goals) {
    if (goal.status !== 'active') continue;
    const health = computeGoalHealth({ goal, projects, tasks, milestones: input.goalMilestones, now });
    if (health.score < 75) {
      sections.push({
        id: `goal-${goal.id}`,
        kind: 'goal',
        label: 'GOAL',
        title: goal.title,
        detail: `${health.metrics.progress}% complete — ${health.reasons[0] ?? 'on track'}`,
        entityType: 'goal',
        entityId: goal.id,
        actionUrl: `/goals/${goal.id}`,
        severity: health.score < 50 ? 'high' : 'medium',
      });
    }
  }

  const focusBlocks = blocks.filter((block) => block.kind === 'focus' && block.status !== 'cancelled');
  if (focusBlocks.length > 0) {
    const plannedMinutes = focusBlocks.reduce(
      (sum, block) => sum + Math.max(0, (new Date(block.end_at).getTime() - new Date(block.start_at).getTime()) / 60000),
      0,
    );
    sections.push({
      id: 'schedule',
      kind: 'schedule',
      label: 'SCHEDULE',
      title: `${focusBlocks.length} focused work block${focusBlocks.length === 1 ? '' : 's'}`,
      detail: `${Math.round(plannedMinutes)} minutes planned, first at ${formatTime(focusBlocks[0].start_at, timezone)}`,
      entityType: 'plan',
      entityId: null,
      actionUrl: '/calendar',
      severity: 'low',
    });
  }

  const unread = notifications.filter((notification) => !notification.read_at);
  const hour = Number.parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(now), 10);

  const priorityCount = sections.filter((section) => section.kind === 'priority').length;
  const headline =
    priorityCount === 0 && sections.length === 0
      ? 'Nothing urgent. A good moment to plan ahead.'
      : `You have ${sections.length} important ${sections.length === 1 ? 'item' : 'items'} today.`;

  return {
    greeting: greetingForHour(hour),
    headline,
    dateLabel: new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(now),
    sections: sections.slice(0, 6),
    metrics: {
      activeGoals: goals.filter((goal) => goal.status === 'active').length,
      activeProjects: projects.filter((project) => project.status !== 'archived' && project.status !== 'completed').length,
      tasksDueToday: dueToday.length,
      overdueTasks: overdue.length,
      completedToday,
      focusBlocks: focusBlocks.length,
      plannedMinutes: Math.round(
        focusBlocks.reduce((sum, block) => sum + Math.max(0, (new Date(block.end_at).getTime() - new Date(block.start_at).getTime()) / 60000), 0),
      ),
      unreadNotifications: unread.length,
    },
  };
}

function describeTask(task: Task, now: Date): string {
  const parts: string[] = [];
  if (task.due_date) {
    const days = daysUntil(task.due_date, now);
    if (days !== null && days < 0) parts.push(`${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`);
    else if (days === 0) parts.push('due today');
    else if (days === 1) parts.push('due tomorrow');
    else parts.push(`due in ${days} days`);
  }
  if (task.estimated_minutes) parts.push(`${task.estimated_minutes} min`);
  if (parts.length === 0) parts.push('no deadline set');
  return parts.join(' · ');
}

function dateKey(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Dashboard analytics — all derived, zero invented numbers. */
export function dashboardAnalytics(input: {
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
  goalMilestones: Array<{ goal_id: string; status: string }>;
  now: Date;
}): {
  activeGoals: number;
  activeProjects: number;
  tasksDueToday: number;
  overdueTasks: number;
  completedTasks: number;
  goalProgress: number;
  projectHealth: number;
} {
  const openTasks = input.tasks.filter((task) => task.status !== 'cancelled');
  const activeGoals = input.goals.filter((goal) => goal.status === 'active');
  const activeProjects = input.projects.filter((project) => project.status !== 'archived');

  return {
    activeGoals: activeGoals.length,
    activeProjects: activeProjects.length,
    tasksDueToday: openTasks.filter(
      (task) => task.status !== 'completed' && task.due_date && daysUntil(task.due_date, input.now) === 0,
    ).length,
    overdueTasks: openTasks.filter(
      (task) => task.status !== 'completed' && task.due_date && (daysUntil(task.due_date, input.now) ?? 0) < 0,
    ).length,
    completedTasks: input.tasks.filter((task) => task.status === 'completed').length,
    goalProgress:
      activeGoals.length === 0 ? 0 : Math.round(activeGoals.reduce((sum, goal) => sum + goal.progress, 0) / activeGoals.length),
    projectHealth:
      activeProjects.length === 0
        ? 0
        : Math.round(activeProjects.reduce((sum, project) => sum + project.health, 0) / activeProjects.length),
  };
}
