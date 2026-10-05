/**
 * Agent permission model.
 *
 * Every tool is classified READ / WRITE / SENSITIVE and is checked against the
 * user's own `ai_permissions` row *before* it is executed. Nothing in this file
 * trusts the model: the model can ask, the backend decides.
 */

import type { AiPermissions, PermissionLevel } from '../types';

export type PermissionDecision =
  | { status: 'allowed'; level: PermissionLevel }
  | { status: 'denied'; level: PermissionLevel; reason: string }
  | { status: 'needs_confirmation'; level: PermissionLevel; reason: string; preview: string };

/** Which `ai_permissions` column gates each write tool. */
const WRITE_GATE: Record<string, keyof AiPermissions> = {
  create_goal: 'create_goals',
  update_goal: 'update_goals',
  create_project: 'create_projects',
  update_project: 'update_projects',
  create_milestone: 'create_milestones',
  update_milestone: 'create_milestones',
  create_task: 'create_tasks',
  update_task: 'update_tasks',
  complete_task: 'update_tasks',
  delete_task: 'delete_tasks',
  create_task_dependency: 'update_tasks',
  remove_task_dependency: 'update_tasks',
  create_daily_plan: 'plan_daily_schedule',
  update_daily_plan: 'plan_daily_schedule',
  create_time_block: 'plan_daily_schedule',
  update_time_block: 'plan_daily_schedule',
  create_notification: 'create_reminders',
  create_action_from_inbox: 'create_tasks',
  plan_goal_breakdown: 'create_goals',
  create_memory: 'create_tasks',
};

/** Tools that create or destroy many records at once. */
const SENSITIVE_TOOLS = new Set([
  'delete_task',
  'delete_project',
  'delete_goal',
  'plan_goal_breakdown',
  'bulk_update_tasks',
]);

/** Tools the agent may always run - they only read the caller's own data. */
const READ_TOOLS = new Set([
  'get_goal',
  'list_goals',
  'get_project',
  'list_projects',
  'get_task',
  'list_tasks',
  'get_daily_plan',
  'create_daily_plan',
  'get_next_best_action',
  'get_project_health',
  'get_goal_health',
  'get_daily_workload',
  'get_user_context',
  'retrieve_memory',
  'list_notifications',
  'list_agent_activity',
  'analyze_inbox_item',
  'mark_notification_read',
]);

export function toolPermission(tool: string): PermissionLevel {
  if (SENSITIVE_TOOLS.has(tool)) return 'sensitive';
  if (READ_TOOLS.has(tool)) return 'read';
  return 'write';
}

export interface PermissionCheckOptions {
  /** The user explicitly confirmed a sensitive action in this turn. */
  confirmed?: boolean;
  /** Human-readable summary of what will change, shown before confirmation. */
  preview?: string;
}

export function evaluatePermission(
  tool: string,
  permissions: AiPermissions | null,
  options: PermissionCheckOptions = {},
): PermissionDecision {
  const level = toolPermission(tool);

  if (level === 'read') return { status: 'allowed', level };

  const gate = WRITE_GATE[tool];
  // `mark_notification_read` and memory reads are always allowed on own data.
  if (!gate) return { status: 'allowed', level };

  if (permissions && permissions[gate] === false) {
    return {
      status: 'denied',
      level,
      reason: `"${tool}" is switched off. Enable it in Settings > AI permissions.`,
    };
  }

  if (level === 'sensitive') {
    // `require_confirmation` = the user wants to approve sensitive actions.
    if (permissions?.require_confirmation !== false && !options.confirmed) {
      return {
        status: 'needs_confirmation',
        level,
        reason: 'This action changes several records and needs your confirmation.',
        preview: options.preview ?? 'Review the proposed changes and confirm to continue.',
      };
    }
    if (permissions?.sensitive_actions === false && permissions.require_confirmation === false) {
      return {
        status: 'denied',
        level,
        reason: 'Sensitive actions are disabled in Settings > AI permissions.',
      };
    }
  }

  return { status: 'allowed', level };
}

/** Compact summary of the permission model for the settings screen. */
export function permissionSummary(permissions: AiPermissions | null): Array<{
  level: PermissionLevel;
  label: string;
  granted: boolean;
}> {
  const rows: Array<{ level: PermissionLevel; label: string; key: keyof AiPermissions }> = [
    { level: 'read', label: 'Read goals, projects, tasks, plans and notifications', key: 'create_tasks' },
    { level: 'write', label: 'Create tasks', key: 'create_tasks' },
    { level: 'write', label: 'Reschedule tasks', key: 'reschedule_tasks' },
    { level: 'write', label: 'Create reminders', key: 'create_reminders' },
    { level: 'write', label: 'Update project status', key: 'update_project_status' },
    { level: 'write', label: 'Plan the daily schedule', key: 'plan_daily_schedule' },
    { level: 'sensitive', label: 'Delete tasks automatically', key: 'delete_tasks' },
    { level: 'sensitive', label: 'Delete projects automatically', key: 'delete_projects' },
    { level: 'sensitive', label: 'Bulk modifications', key: 'bulk_operations' },
    { level: 'sensitive', label: 'Other sensitive actions', key: 'sensitive_actions' },
  ];
  return rows.map((row) => ({ level: row.level, label: row.label, granted: permissions ? permissions[row.key] !== false : false }));
}
