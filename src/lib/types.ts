/**
 * VozPilot — shared domain types.
 *
 * These mirror the Postgres schema in `supabase/migrations`. Every user-owned
 * entity carries `user_id`; the value is always derived from the authenticated
 * session on the server, never from client input.
 */

export type UUID = string;

export type GoalStatus = 'active' | 'paused' | 'completed' | 'archived';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type ProjectStatus = 'planning' | 'active' | 'blocked' | 'at_risk' | 'completed' | 'archived';
export type TaskStatus = 'inbox' | 'todo' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export type MilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'missed';
export type NotificationPriority = 'critical' | 'high' | 'medium' | 'low';
export type NotificationCategory = 'tasks' | 'projects' | 'goals' | 'inbox' | 'system';
export type MemoryCategory =
  | 'user_preferences'
  | 'goals'
  | 'projects'
  | 'working_style'
  | 'recurring_patterns'
  | 'important_context'
  | 'completed_milestones'
  | 'historical_decisions';

export type AgentName = 'vozcore' | 'vozgoal' | 'vozproject' | 'vozday' | 'vozinbox';
export type PermissionLevel = 'read' | 'write' | 'sensitive';

export interface Profile {
  id: UUID;
  full_name: string;
  avatar_url: string | null;
  timezone: string;
  locale: string;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  user_id: UUID;
  timezone: string;
  workday_start: string;
  workday_end: string;
  break_minutes: number;
  max_daily_blocks: number;
  briefing_enabled: boolean;
  deadline_alerts: boolean;
  project_alerts: boolean;
  goal_alerts: boolean;
  inbox_alerts: boolean;
  agent_alerts: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiPermissions {
  user_id: UUID;
  create_tasks: boolean;
  update_tasks: boolean;
  reschedule_tasks: boolean;
  create_reminders: boolean;
  create_goals: boolean;
  update_goals: boolean;
  create_projects: boolean;
  update_projects: boolean;
  update_project_status: boolean;
  create_milestones: boolean;
  plan_daily_schedule: boolean;
  delete_tasks: boolean;
  delete_projects: boolean;
  delete_goals: boolean;
  bulk_operations: boolean;
  sensitive_actions: boolean;
  require_confirmation: boolean;
  created_at: string;
  updated_at: string;
}

export interface Goal {
  id: UUID;
  user_id: UUID;
  title: string;
  description: string;
  category: string;
  priority: Priority;
  status: GoalStatus;
  target_date: string | null;
  progress: number;
  health: number;
  health_note: string;
  color: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface GoalMilestone {
  id: UUID;
  user_id: UUID;
  goal_id: UUID;
  title: string;
  description: string;
  due_date: string | null;
  status: MilestoneStatus;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: UUID;
  user_id: UUID;
  goal_id: UUID | null;
  title: string;
  description: string;
  status: ProjectStatus;
  priority: Priority;
  start_date: string | null;
  target_date: string | null;
  health: number;
  risk: number;
  health_note: string;
  notes: string;
  progress: number;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectMilestone {
  id: UUID;
  user_id: UUID;
  project_id: UUID;
  title: string;
  description: string;
  due_date: string | null;
  status: MilestoneStatus;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: UUID;
  user_id: UUID;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  estimated_minutes: number | null;
  actual_minutes: number | null;
  project_id: UUID | null;
  goal_id: UUID | null;
  milestone_id: UUID | null;
  goal_milestone_id: UUID | null;
  scheduled_date: string | null;
  tags: string[];
  source: 'manual' | 'agent' | 'inbox' | 'recurring' | 'import';
  idempotency_key: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskDependency {
  id: UUID;
  user_id: UUID;
  task_id: UUID;
  depends_on_task_id: UUID;
  created_at: string;
}

export interface DailyPlan {
  id: UUID;
  user_id: UUID;
  plan_date: string;
  summary: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
  generated_by: 'agent' | 'user' | 'system';
  created_at: string;
  updated_at: string;
}

export type TimeBlockKind = 'focus' | 'commitment' | 'break' | 'buffer' | 'review';

export interface TimeBlock {
  id: UUID;
  user_id: UUID;
  daily_plan_id: UUID | null;
  task_id: UUID | null;
  title: string;
  start_at: string;
  end_at: string;
  kind: TimeBlockKind;
  status: 'planned' | 'in_progress' | 'completed' | 'skipped' | 'cancelled';
  position: number;
  created_at: string;
  updated_at: string;
}

export interface InboxItem {
  id: UUID;
  user_id: UUID;
  source: 'manual' | 'email' | 'agent' | 'integration';
  sender: string;
  subject: string;
  body: string;
  received_at: string;
  status: 'new' | 'analyzed' | 'actioned' | 'dismissed' | 'archived';
  analysis: InboxAnalysis | null;
  matched_project_id: UUID | null;
  matched_goal_id: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface InboxAnalysis {
  intent: string;
  summary: string;
  deadline: string | null;
  detected_date_text: string | null;
  detected_time_text: string | null;
  actions: InboxActionSuggestion[];
  priority: Priority;
  confidence: number;
  matched_project_id: UUID | null;
  matched_project_title: string | null;
  matched_goal_id: UUID | null;
  matched_goal_title: string | null;
  reasoning: string;
}

export interface InboxActionSuggestion {
  kind: 'task' | 'reminder' | 'event' | 'follow_up' | 'deadline';
  title: string;
  due_date: string | null;
  priority: Priority;
  confidence: number;
}

export interface InboxAction {
  id: UUID;
  user_id: UUID;
  inbox_item_id: UUID;
  kind: 'task' | 'reminder' | 'event' | 'follow_up' | 'deadline';
  title: string;
  due_date: string | null;
  priority: Priority;
  project_id: UUID | null;
  goal_id: UUID | null;
  confidence: number;
  status: 'suggested' | 'accepted' | 'rejected' | 'created' | 'dismissed';
  created_task_id: UUID | null;
  created_at: string;
  updated_at: string;
}

export type NotificationType =
  | 'deadline_approaching'
  | 'task_overdue'
  | 'project_at_risk'
  | 'goal_milestone'
  | 'inbox_action'
  | 'daily_briefing'
  | 'schedule_conflict'
  | 'next_task'
  | 'agent_action'
  | 'system';

export interface Notification {
  id: UUID;
  user_id: UUID;
  type: NotificationType;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: UUID | null;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
}

export interface Memory {
  id: UUID;
  user_id: UUID;
  category: MemoryCategory;
  content: string;
  importance: number;
  source: 'agent' | 'user' | 'system' | 'onboarding';
  use_count: number;
  last_used_at: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentRun {
  id: UUID;
  user_id: UUID;
  agent: AgentName;
  channel: 'chat' | 'system' | 'api' | 'onboarding' | 'cron';
  input_summary: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'limit_reached';
  iterations: number;
  tool_calls: number;
  provider: string;
  model: string;
  error: string | null;
  duration_ms: number | null;
  started_at: string;
  finished_at: string | null;
}

export interface AgentAction {
  id: UUID;
  user_id: UUID;
  run_id: UUID | null;
  agent: AgentName;
  tool: string;
  action: string;
  entity_type: string | null;
  entity_id: UUID | null;
  permission: PermissionLevel;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  status: 'success' | 'failed' | 'denied' | 'skipped' | 'validated';
  reason: string;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface AiConversation {
  id: UUID;
  user_id: UUID;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AiMessage {
  id: UUID;
  user_id: UUID;
  conversation_id: UUID;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls: unknown | null;
  action_summary: unknown | null;
  created_at: string;
}

export type IntegrationProvider = 'calendar' | 'email' | 'github' | 'webhook' | 'whatsapp';

export interface Integration {
  id: UUID;
  user_id: UUID;
  provider: IntegrationProvider;
  status: 'not_configured' | 'configured' | 'connected' | 'error' | 'disabled';
  display_name: string;
  config: Record<string, unknown>;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

/** The fully hydrated context bundle handed to VozCore and its sub-agents. */
export interface UserContext {
  profile: Profile;
  preferences: UserPreferences;
  permissions: AiPermissions;
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
  inboxItems: InboxItem[];
  notifications: Notification[];
  memories: Memory[];
  todayPlan: DailyPlan | null;
  todayBlocks: TimeBlock[];
}
