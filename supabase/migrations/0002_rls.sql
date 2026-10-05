-- =============================================================================
-- VozPilot — Migration 0002: Row Level Security
--
-- Rule: a user can only ever see or touch their own rows. Policies are written
-- against `auth.uid()` which is derived from the verified JWT server-side — the
-- client can never spoof `user_id` to read another user's data.
-- =============================================================================

alter table public.profiles           enable row level security;
alter table public.user_preferences   enable row level security;
alter table public.ai_permissions     enable row level security;
alter table public.goals              enable row level security;
alter table public.goal_milestones    enable row level security;
alter table public.projects           enable row level security;
alter table public.project_milestones enable row level security;
alter table public.tasks              enable row level security;
alter table public.task_dependencies  enable row level security;
alter table public.daily_plans        enable row level security;
alter table public.time_blocks        enable row level security;
alter table public.inbox_items        enable row level security;
alter table public.inbox_actions      enable row level security;
alter table public.notifications      enable row level security;
alter table public.memories           enable row level security;
alter table public.agent_runs         enable row level security;
alter table public.agent_actions      enable row level security;
alter table public.ai_conversations   enable row level security;
alter table public.ai_messages        enable row level security;
alter table public.integrations       enable row level security;

-- -----------------------------------------------------------------------------
-- profiles: a user may only read/update their own profile row.
-- -----------------------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- -----------------------------------------------------------------------------
-- Generic owner-only policies for every user-owned table.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  owner_tables text[] := array[
    'user_preferences','ai_permissions','goals','goal_milestones','projects',
    'project_milestones','tasks','task_dependencies','daily_plans','time_blocks',
    'inbox_items','inbox_actions','notifications','memories','agent_runs',
    'agent_actions','ai_conversations','ai_messages','integrations'
  ];
begin
  foreach t in array owner_tables loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for select using (auth.uid() = user_id)',
      t || '_select_own', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for insert with check (auth.uid() = user_id)',
      t || '_insert_own', t);

    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_update_own', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format(
      'create policy %I on public.%I for delete using (auth.uid() = user_id)',
      t || '_delete_own', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- New-user bootstrap. `security definer` so a freshly signed-up user gets their
-- preference/permission rows without needing elevated client privileges.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, timezone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC')
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.ai_permissions (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
