/**
 * Zod validation schemas.
 *
 * Every API route validates its payload against one of these before touching the
 * database. Nothing in here is allowed to trust a client-supplied `user_id`.
 */

import { z } from 'zod';

export const uuid = z.uuid('Must be a valid UUID');

const trimmed = (min: number, max: number) =>
  z
    .string({ error: 'Required' })
    .transform((value) => value.trim())
    .refine((value) => value.length >= min, { message: `Must be at least ${min} character(s)` })
    .refine((value) => value.length <= max, { message: `Must be at most ${max} character(s)` });

const optionalText = (max = 5000) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length <= max, { message: `Must be at most ${max} characters` })
    .optional()
    .or(z.literal('').transform(() => undefined));

/** yyyy-MM-dd calendar date. */
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format')
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), 'Invalid date');

/** Full ISO-8601 timestamp with offset. */
export const isoDateTime = z.iso.datetime({ offset: true, message: 'Must be a valid ISO-8601 timestamp' });

export const priority = z.enum(['low', 'medium', 'high', 'critical']);
export const taskStatus = z.enum(['inbox', 'todo', 'in_progress', 'blocked', 'completed', 'cancelled']);
export const projectStatus = z.enum(['planning', 'active', 'blocked', 'at_risk', 'completed', 'archived']);
export const goalStatus = z.enum(['active', 'paused', 'completed', 'archived']);
export const milestoneStatus = z.enum(['pending', 'in_progress', 'completed', 'missed']);
export const memoryCategory = z.enum([
  'user_preferences',
  'goals',
  'projects',
  'working_style',
  'recurring_patterns',
  'important_context',
  'completed_milestones',
  'historical_decisions',
]);

const nullableDate = z.union([dateOnly, z.null()]).optional();
const nullableUuid = z.union([uuid, z.null()]).optional();

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const signupSchema = z.object({
  email: z.email('Enter a valid email address').transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters')
    .refine((value) => /[a-zA-Z]/.test(value), 'Password must contain a letter')
    .refine((value) => /[0-9]/.test(value) || /[^a-zA-Z0-9]/.test(value), 'Password must contain a number or symbol'),
  full_name: trimmed(1, 120),
  timezone: z.string().min(1).max(64).default('UTC'),
});

export const loginSchema = z.object({
  email: z.email('Enter a valid email address').transform((value) => value.toLowerCase()),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.email('Enter a valid email address').transform((value) => value.toLowerCase()),
});

export const resetPasswordSchema = z.object({
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters'),
});

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------
export const onboardingSchema = z.object({
  full_name: trimmed(1, 120).optional(),
  timezone: z.string().min(1).max(64).optional(),
  main_goals: z.array(trimmed(1, 200)).max(5).optional(),
  availability: z
    .object({
      workday_start: z.string().regex(/^\d{2}:\d{2}$/),
      workday_end: z.string().regex(/^\d{2}:\d{2}$/),
      max_daily_blocks: z.number().int().min(1).max(16),
    })
    .optional(),
  working_style: z.string().max(1000).optional(),
  notification_preferences: z
    .object({
      briefing_enabled: z.boolean(),
      deadline_alerts: z.boolean(),
      project_alerts: z.boolean(),
      goal_alerts: z.boolean(),
      inbox_alerts: z.boolean(),
    })
    .optional(),
  ai_permissions: z.record(z.string(), z.boolean()).optional(),
});

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------
export const createGoalSchema = z.object({
  title: trimmed(1, 200),
  description: optionalText(5000),
  category: z
    .enum(['career', 'learning', 'health', 'finance', 'personal', 'project', 'general'])
    .default('general'),
  priority: priority.default('medium'),
  target_date: nullableDate,
});

export const updateGoalSchema = createGoalSchema.partial().extend({
  status: goalStatus.optional(),
  position: z.number().int().min(0).max(9999).optional(),
});

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------
export const createMilestoneSchema = z.object({
  title: trimmed(1, 200),
  description: optionalText(2000),
  due_date: nullableDate,
  position: z.number().int().min(0).max(9999).optional(),
});

export const updateMilestoneSchema = createMilestoneSchema.partial().extend({
  status: milestoneStatus.optional(),
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
export const createProjectSchema = z.object({
  title: trimmed(1, 200),
  description: optionalText(5000),
  goal_id: nullableUuid,
  status: projectStatus.default('planning'),
  priority: priority.default('medium'),
  start_date: nullableDate,
  target_date: nullableDate,
  notes: optionalText(5000),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  position: z.number().int().min(0).max(9999).optional(),
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
export const createTaskSchema = z.object({
  title: trimmed(1, 300),
  description: optionalText(5000),
  status: taskStatus.default('todo'),
  priority: priority.default('medium'),
  due_date: z.union([isoDateTime, z.null()]).optional(),
  estimated_minutes: z.number().int().min(1).max(1440).nullable().optional(),
  project_id: nullableUuid,
  goal_id: nullableUuid,
  milestone_id: nullableUuid,
  scheduled_date: nullableDate,
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  idempotency_key: z.string().max(120).nullable().optional(),
});

export const updateTaskSchema = createTaskSchema.partial().extend({
  actual_minutes: z.number().int().min(0).max(10080).nullable().optional(),
});

export const completeTaskSchema = z.object({
  actual_minutes: z.number().int().min(0).max(10080).nullable().optional(),
});

export const createDependencySchema = z.object({
  task_id: uuid,
  depends_on_task_id: uuid,
});

// ---------------------------------------------------------------------------
// Daily plan / time blocks
// ---------------------------------------------------------------------------
export const createTimeBlockSchema = z.object({
  title: trimmed(1, 200),
  start_at: isoDateTime,
  end_at: isoDateTime,
  kind: z.enum(['focus', 'commitment', 'break', 'buffer', 'review']).default('focus'),
  task_id: nullableUuid,
  daily_plan_id: nullableUuid,
  position: z.number().int().min(0).max(9999).optional(),
});

export const updateTimeBlockSchema = createTimeBlockSchema.partial();

export const generatePlanSchema = z.object({
  date: dateOnly.optional(),
  force: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
export const createInboxItemSchema = z.object({
  source: z.enum(['manual', 'email', 'agent', 'integration']).default('manual'),
  sender: z.string().trim().max(320).optional(),
  subject: z.string().trim().max(500).optional(),
  body: trimmed(1, 20000),
  received_at: isoDateTime.optional(),
});

export const updateInboxItemSchema = z.object({
  status: z.enum(['new', 'analyzed', 'actioned', 'dismissed', 'archived']).optional(),
});

export const createActionFromInboxSchema = z.object({
  inbox_item_id: uuid,
  kind: z.enum(['task', 'reminder', 'event', 'follow_up', 'deadline']).default('task'),
  title: trimmed(1, 300),
  due_date: z.union([isoDateTime, z.null()]).optional(),
  priority: priority.default('medium'),
  project_id: nullableUuid,
  goal_id: nullableUuid,
  estimated_minutes: z.number().int().min(1).max(1440).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export const createNotificationSchema = z.object({
  type: z.enum([
    'deadline_approaching',
    'task_overdue',
    'project_at_risk',
    'goal_milestone',
    'inbox_action',
    'daily_briefing',
    'schedule_conflict',
    'next_task',
    'agent_action',
    'system',
  ]),
  title: trimmed(1, 200),
  body: optionalText(2000),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
  category: z.enum(['tasks', 'projects', 'goals', 'inbox', 'system']).default('system'),
  entity_type: z.string().max(60).nullable().optional(),
  entity_id: uuid.nullable().optional(),
  action_url: z.string().max(500).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------
export const createMemorySchema = z.object({
  category: memoryCategory,
  content: trimmed(1, 2000),
  importance: z.number().int().min(0).max(100).default(50),
  pinned: z.boolean().default(false),
  source: z.enum(['agent', 'user', 'system', 'onboarding']).default('user'),
});

export const updateMemorySchema = createMemorySchema.partial();

// ---------------------------------------------------------------------------
// Preferences / permissions
// ---------------------------------------------------------------------------
export const updatePreferencesSchema = z.object({
  timezone: z.string().min(1).max(64).optional(),
  workday_start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  workday_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  break_minutes: z.number().int().min(0).max(120).optional(),
  max_daily_blocks: z.number().int().min(1).max(16).optional(),
  briefing_enabled: z.boolean().optional(),
  deadline_alerts: z.boolean().optional(),
  project_alerts: z.boolean().optional(),
  goal_alerts: z.boolean().optional(),
  inbox_alerts: z.boolean().optional(),
  agent_alerts: z.boolean().optional(),
  quiet_hours_start: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quiet_hours_end: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

export const updatePermissionsSchema = z.object({
  create_tasks: z.boolean().optional(),
  update_tasks: z.boolean().optional(),
  reschedule_tasks: z.boolean().optional(),
  create_reminders: z.boolean().optional(),
  create_goals: z.boolean().optional(),
  update_goals: z.boolean().optional(),
  create_projects: z.boolean().optional(),
  update_projects: z.boolean().optional(),
  update_project_status: z.boolean().optional(),
  create_milestones: z.boolean().optional(),
  plan_daily_schedule: z.boolean().optional(),
  delete_tasks: z.boolean().optional(),
  delete_projects: z.boolean().optional(),
  delete_goals: z.boolean().optional(),
  bulk_operations: z.boolean().optional(),
  sensitive_actions: z.boolean().optional(),
  require_confirmation: z.boolean().optional(),
});

export const updateProfileSchema = z.object({
  full_name: trimmed(1, 120).optional(),
  timezone: z.string().min(1).max(64).optional(),
  avatar_url: z.string().url().max(2000).nullable().optional(),
  locale: z.string().min(2).max(20).optional(),
});

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------
export const aiChatSchema = z.object({
  message: trimmed(1, 4000),
  conversation_id: uuid.optional(),
  confirmed: z.boolean().optional(),
});

export const searchSchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.number().int().min(1).max(30).default(10),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;
export type CreateTimeBlockInput = z.infer<typeof createTimeBlockSchema>;
export type CreateInboxItemInput = z.infer<typeof createInboxItemSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
