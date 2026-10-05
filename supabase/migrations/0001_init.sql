-- =============================================================================
-- VozPilot — Migration 0001: Core schema
-- VozPilot by VozLook Studios — Your Autonomous AI Chief-of-Staff
--
-- All timestamps are stored as `timestamptz` (UTC internally). Display and
-- scheduling conversions to the user's configured timezone happen in the
-- application layer (see src/lib/utils/dates.ts).
--
-- Every user-owned table carries `user_id` referencing `auth.users(id)` with
-- ON DELETE CASCADE. Row Level Security is enabled in migration 0002 so that
-- even a leaked client key cannot read another user's rows.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Shared trigger: keep updated_at fresh
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Enumerations (text + CHECK keeps them trivially alterable and index friendly)
-- -----------------------------------------------------------------------------
do $$ begin
  create type goal_status      as enum ('active', 'paused', 'completed', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type goal_priority    as enum ('low', 'medium', 'high', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_status   as enum ('planning', 'active', 'blocked', 'at_risk', 'completed', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status      as enum ('inbox', 'todo', 'in_progress', 'blocked', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type milestone_status as enum ('pending', 'in_progress', 'completed', 'missed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_priority as enum ('critical', 'high', 'medium', 'low');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- profiles — 1:1 with auth.users
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text        not null default '',
  avatar_url    text,
  timezone      text        not null default 'UTC',
  locale        text        not null default 'en-US',
  onboarded_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- user_preferences — scheduling + notification preferences
-- -----------------------------------------------------------------------------
create table if not exists public.user_preferences (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  timezone               text        not null default 'UTC',
  workday_start          time        not null default '09:00',
  workday_end            time        not null default '21:00',
  break_minutes          integer     not null default 10 check (break_minutes between 0 and 120),
  max_daily_blocks       integer     not null default 6  check (max_daily_blocks between 1 and 16),
  briefing_enabled       boolean     not null default true,
  deadline_alerts        boolean     not null default true,
  project_alerts         boolean     not null default true,
  goal_alerts            boolean     not null default true,
  inbox_alerts           boolean     not null default true,
  agent_alerts           boolean     not null default false,
  quiet_hours_start      time,
  quiet_hours_end        time,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

drop trigger if exists trg_user_preferences_updated_at on public.user_preferences;
create trigger trg_user_preferences_updated_at before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- ai_permissions — the explicit agent permission model
--   write_*  : agent may perform without confirmation
--   delete_* / sensitive / bulk : require explicit confirmation
-- -----------------------------------------------------------------------------
create table if not exists public.ai_permissions (
  user_id               uuid primary key references auth.users (id) on delete cascade,

  create_tasks          boolean not null default true,
  update_tasks          boolean not null default true,
  reschedule_tasks      boolean not null default true,
  create_reminders      boolean not null default true,
  create_goals          boolean not null default false,
  update_goals          boolean not null default true,
  create_projects       boolean not null default false,
  update_projects       boolean not null default true,
  update_project_status boolean not null default true,
  create_milestones     boolean not null default true,
  plan_daily_schedule   boolean not null default true,

  delete_tasks          boolean not null default false,
  delete_projects       boolean not null default false,
  delete_goals          boolean not null default false,
  bulk_operations       boolean not null default false,
  sensitive_actions     boolean not null default false,
  require_confirmation  boolean not null default true,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists trg_ai_permissions_updated_at on public.ai_permissions;
create trigger trg_ai_permissions_updated_at before update on public.ai_permissions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- goals
-- -----------------------------------------------------------------------------
create table if not exists public.goals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null check (char_length(trim(title)) between 1 and 200),
  description  text not null default '',
  category     text not null default 'general'
               check (category in ('career','learning','health','finance','personal','project','general')),
  priority     goal_priority not null default 'medium',
  status       goal_status   not null default 'active',
  target_date  date,
  progress     integer not null default 0 check (progress between 0 and 100),
  health       integer not null default 100 check (health between 0 and 100),
  health_note  text not null default '',
  color        text not null default 'violet',
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists goals_user_status_idx on public.goals (user_id, status);
create index if not exists goals_user_target_idx on public.goals (user_id, target_date);

drop trigger if exists trg_goals_updated_at on public.goals;
create trigger trg_goals_updated_at before update on public.goals
  for each row execute function public.set_updated_at();

create table if not exists public.goal_milestones (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  goal_id      uuid not null references public.goals (id) on delete cascade,
  title        text not null check (char_length(trim(title)) between 1 and 200),
  description  text not null default '',
  due_date     date,
  status       milestone_status not null default 'pending',
  position     integer not null default 0,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists goal_milestones_goal_idx on public.goal_milestones (goal_id, position);
create index if not exists goal_milestones_user_idx on public.goal_milestones (user_id, status);

drop trigger if exists trg_goal_milestones_updated_at on public.goal_milestones;
create trigger trg_goal_milestones_updated_at before update on public.goal_milestones
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  goal_id      uuid references public.goals (id) on delete set null,
  title        text not null check (char_length(trim(title)) between 1 and 200),
  description  text not null default '',
  status       project_status not null default 'planning',
  priority     goal_priority  not null default 'medium',
  start_date   date,
  target_date  date,
  health       integer not null default 100 check (health between 0 and 100),
  risk         integer not null default 0   check (risk between 0 and 100),
  health_note  text not null default '',
  notes        text not null default '',
  progress     integer not null default 0 check (progress between 0 and 100),
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists projects_user_status_idx on public.projects (user_id, status);
create index if not exists projects_user_goal_idx    on public.projects (user_id, goal_id);
create index if not exists projects_user_target_idx  on public.projects (user_id, target_date);

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

create table if not exists public.project_milestones (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  title        text not null check (char_length(trim(title)) between 1 and 200),
  description  text not null default '',
  due_date     date,
  status       milestone_status not null default 'pending',
  position     integer not null default 0,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists project_milestones_project_idx on public.project_milestones (project_id, position);

drop trigger if exists trg_project_milestones_updated_at on public.project_milestones;
create trigger trg_project_milestones_updated_at before update on public.project_milestones
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- tasks + dependencies
-- -----------------------------------------------------------------------------
create table if not exists public.tasks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  title             text not null check (char_length(trim(title)) between 1 and 300),
  description       text not null default '',
  status            task_status not null default 'todo',
  priority          goal_priority not null default 'medium',
  due_date          timestamptz,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes between 1 and 1440),
  actual_minutes    integer check (actual_minutes is null or actual_minutes between 0 and 10080),
  project_id        uuid references public.projects (id) on delete set null,
  goal_id           uuid references public.goals (id) on delete set null,
  milestone_id      uuid references public.project_milestones (id) on delete set null,
  goal_milestone_id uuid references public.goal_milestones (id) on delete set null,
  scheduled_date    date,
  tags              text[] not null default '{}',
  source            text not null default 'manual'
                    check (source in ('manual','agent','inbox','recurring','import')),
  idempotency_key   text unique,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists tasks_user_status_idx  on public.tasks (user_id, status);
create index if not exists tasks_user_due_idx     on public.tasks (user_id, due_date);
create index if not exists tasks_user_project_idx on public.tasks (user_id, project_id);
create index if not exists tasks_user_goal_idx    on public.tasks (user_id, goal_id);
create index if not exists tasks_user_sched_idx   on public.tasks (user_id, scheduled_date);
create index if not exists tasks_user_priority_idx on public.tasks (user_id, priority, status);

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

create table if not exists public.task_dependencies (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  task_id            uuid not null references public.tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks (id) on delete cascade,
  created_at         timestamptz not null default now(),
  constraint task_dependencies_no_self check (task_id <> depends_on_task_id),
  constraint task_dependencies_unique unique (task_id, depends_on_task_id)
);

create index if not exists task_dependencies_task_idx on public.task_dependencies (task_id);
create index if not exists task_dependencies_dep_idx  on public.task_dependencies (depends_on_task_id);

-- -----------------------------------------------------------------------------
-- daily plans + time blocks
-- -----------------------------------------------------------------------------
create table if not exists public.daily_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  plan_date   date not null,
  summary     text not null default '',
  status      text not null default 'draft' check (status in ('draft','active','completed','archived')),
  generated_by text not null default 'agent' check (generated_by in ('agent','user','system')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint daily_plans_unique_per_day unique (user_id, plan_date)
);

create index if not exists daily_plans_user_date_idx on public.daily_plans (user_id, plan_date desc);

drop trigger if exists trg_daily_plans_updated_at on public.daily_plans;
create trigger trg_daily_plans_updated_at before update on public.daily_plans
  for each row execute function public.set_updated_at();

create table if not exists public.time_blocks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  daily_plan_id uuid references public.daily_plans (id) on delete cascade,
  task_id       uuid references public.tasks (id) on delete set null,
  title         text not null check (char_length(trim(title)) between 1 and 200),
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  kind          text not null default 'focus'
                check (kind in ('focus','commitment','break','buffer','review')),
  status        text not null default 'planned'
                check (status in ('planned','in_progress','completed','skipped','cancelled')),
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint time_blocks_positive_duration check (end_at > start_at)
);

create index if not exists time_blocks_user_start_idx on public.time_blocks (user_id, start_at);
create index if not exists time_blocks_plan_idx       on public.time_blocks (daily_plan_id, position);

drop trigger if exists trg_time_blocks_updated_at on public.time_blocks;
create trigger trg_time_blocks_updated_at before update on public.time_blocks
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- inbox
-- -----------------------------------------------------------------------------
create table if not exists public.inbox_items (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  source             text not null default 'manual'
                     check (source in ('manual','email','agent','integration')),
  sender             text not null default '',
  subject            text not null default '' check (char_length(subject) <= 500),
  body               text not null default '',
  received_at        timestamptz not null default now(),
  status             text not null default 'new'
                     check (status in ('new','analyzed','actioned','dismissed','archived')),
  analysis           jsonb,
  matched_project_id uuid references public.projects (id) on delete set null,
  matched_goal_id    uuid references public.goals (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists inbox_items_user_status_idx on public.inbox_items (user_id, status, received_at desc);

drop trigger if exists trg_inbox_items_updated_at on public.inbox_items;
create trigger trg_inbox_items_updated_at before update on public.inbox_items
  for each row execute function public.set_updated_at();

create table if not exists public.inbox_actions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  inbox_item_id uuid not null references public.inbox_items (id) on delete cascade,
  kind          text not null check (kind in ('task','reminder','event','follow_up','deadline')),
  title         text not null check (char_length(trim(title)) between 1 and 300),
  due_date      timestamptz,
  priority      goal_priority not null default 'medium',
  project_id    uuid references public.projects (id) on delete set null,
  goal_id       uuid references public.goals (id) on delete set null,
  confidence    double precision not null default 0 check (confidence between 0 and 1),
  status        text not null default 'suggested'
                check (status in ('suggested','accepted','rejected','created','cismissed')),
  created_task_id uuid references public.tasks (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists inbox_actions_item_idx on public.inbox_actions (inbox_item_id, status);

drop trigger if exists trg_inbox_actions_updated_at on public.inbox_actions;
create trigger trg_inbox_actions_updated_at before update on public.inbox_actions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  type        text not null
              check (type in ('deadline_approaching','task_overdue','project_at_risk','goal_milestone',
                              'inbox_action','daily_briefing','schedule_conflict','next_task','agent_action',
                              'system')),
  category    text not null default 'system'
              check (category in ('tasks','projects','goals','inbox','system')),
  priority    notification_priority not null default 'medium',
  title       text not null check (char_length(trim(title)) between 1 and 200),
  body        text not null default '',
  entity_type text,
  entity_id   uuid,
  action_url  text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx  on public.notifications (user_id, read_at) where read_at is null;
create index if not exists notifications_user_type_idx    on public.notifications (user_id, type);

-- -----------------------------------------------------------------------------
-- memory
-- -----------------------------------------------------------------------------
create table if not exists public.memories (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  category     text not null
               check (category in ('user_preferences','goals','projects','working_style',
                                   'recurring_patterns','important_context','completed_milestones',
                                   'historical_decisions')),
  content      text not null check (char_length(trim(content)) between 1 and 2000),
  importance   integer not null default 50 check (importance between 0 and 100),
  source       text not null default 'agent' check (source in ('agent','user','system','onboarding')),
  use_count    integer not null default 0,
  last_used_at timestamptz,
  pinned       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists memories_user_category_idx on public.memories (user_id, category, importance desc);

drop trigger if exists trg_memories_updated_at on public.memories;
create trigger trg_memories_updated_at before update on public.memories
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- agent runs + actions (audit log)
-- -----------------------------------------------------------------------------
create table if not exists public.agent_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  agent         text not null check (agent in ('vozcore','vozgoal','vozproject','vozday','vozinbox')),
  channel       text not null default 'chat' check (channel in ('chat','system','api','onboarding','cron')),
  input_summary text not null default '',
  status        text not null default 'running'
                check (status in ('running','completed','failed','cancelled','limit_reached')),
  iterations    integer not null default 0,
  tool_calls    integer not null default 0,
  provider      text not null default 'local',
  model         text not null default 'local-reasoning-v1',
  error         text,
  duration_ms   integer,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index if not exists agent_runs_user_started_idx on public.agent_runs (user_id, started_at desc);

create table if not exists public.agent_actions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  run_id       uuid references public.agent_runs (id) on delete cascade,
  agent        text not null check (agent in ('vozcore','vozgoal','vozproject','vozday','vozinbox')),
  tool         text not null,
  action       text not null default '',
  entity_type  text,
  entity_id    uuid,
  permission   text not null default 'read' check (permission in ('read','write','sensitive')),
  input        jsonb not null default '{}'::jsonb,
  output       jsonb not null default '{}'::jsonb,
  status       text not null default 'success'
               check (status in ('success','failed','denied','skipped','validated')),
  reason       text not null default '',
  error        text,
  duration_ms  integer,
  created_at   timestamptz not null default now()
);

create index if not exists agent_actions_user_created_idx on public.agent_actions (user_id, created_at desc);
create index if not exists agent_actions_run_idx          on public.agent_actions (run_id, created_at);
create index if not exists agent_actions_tool_idx         on public.agent_actions (user_id, tool);

-- -----------------------------------------------------------------------------
-- ai conversations
-- -----------------------------------------------------------------------------
create table if not exists public.ai_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  role            text not null check (role in ('user','assistant','system','tool')),
  content         text not null default '',
  tool_calls      jsonb,
  action_summary  jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists ai_messages_conv_idx on public.ai_messages (conversation_id, created_at);

-- -----------------------------------------------------------------------------
-- integrations (extensible channel registry — WhatsApp is intentionally absent)
-- -----------------------------------------------------------------------------
create table if not exists public.integrations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  provider     text not null check (provider in ('calendar','email','github','webhook','whatsapp')),
  status       text not null default 'not_configured'
               check (status in ('not_configured','configured','connected','error','disabled')),
  display_name text not null default '',
  config       jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint integrations_unique_per_user unique (user_id, provider)
);

create index if not exists integrations_user_idx on public.integrations (user_id);

drop trigger if exists trg_integrations_updated_at on public.integrations;
create trigger trg_integrations_updated_at before update on public.integrations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Derived-metric helpers. The application layer also computes these values in
-- TypeScript (src/lib/engine/*) so the numbers are identical whether they were
-- produced by the API or by a direct SQL maintenance job.
-- -----------------------------------------------------------------------------
create or replace function public.recalculate_project_progress(p_project_id uuid)
returns integer
language plpgsql
security invoker
as $$
declare
  v_total integer;
  v_done  integer;
begin
  select count(*), count(*) filter (where t.status = 'completed')
    into v_total, v_done
  from public.tasks t
  where t.project_id = p_project_id
    and t.status <> 'cancelled';

  if v_total = 0 then
    return 0;
  end if;

  return round((v_done::numeric / v_total) * 100);
end;
$$;

create or replace function public.recalculate_goal_progress(p_goal_id uuid)
returns integer
language plpgsql
security invoker
as $$
declare
  v_project_part numeric := 0;
  v_milestone_part numeric := 0;
begin
  -- 60% weight from linked projects, 40% from goal milestones.
  select coalesce(avg(public.recalculate_project_progress(pr.id)), 0)
    into v_project_part
  from public.projects pr
  where pr.goal_id = p_goal_id
    and pr.status <> 'archived';

  select coalesce(
           (count(*) filter (where m.status = 'completed'))::numeric
           / nullif(count(*), 0), 0) * 100
    into v_milestone_part
  from public.goal_milestones m
  where m.goal_id = p_goal_id;

  return least(100, greatest(0, round(v_project_part * 0.6 + v_milestone_part * 0.4)))::integer;
end;
$$;
