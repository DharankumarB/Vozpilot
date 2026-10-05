/**
 * Server-side page context helper.
 *
 * Pages resolve the authenticated user here. `userId` always comes from the
 * verified Supabase session - never from a query param, cookie or header the
 * client controls.
 */

import { redirect } from 'next/navigation';
import { createServerDbClient, isSupabaseConfigured } from '../supabase/client';
import type { DbClient } from '../db/client';
import type { Profile, UserPreferences } from '../types';
import { todayInZone } from '../utils/dates';

export interface PageContext {
  db: DbClient;
  userId: string;
  email: string;
  profile: Profile | null;
  timezone: string;
  preferences: UserPreferences | null;
  today: string;
}

export async function getPageContext(): Promise<PageContext> {
  if (!isSupabaseConfigured()) redirect('/login?setup=required');
  const supabase = await createServerDbClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard');

  const db = supabase as unknown as DbClient;
  const [{ data: profile }, { data: preferences }] = await Promise.all([
    db.from<Profile>('profiles').select('*').eq('id', user.id).maybeSingle(),
    db.from<UserPreferences>('user_preferences').select('*').eq('user_id', user.id).maybeSingle(),
  ]);

  const timezone = preferences?.timezone ?? profile?.timezone ?? 'UTC';

  return {
    db,
    userId: user.id,
    email: user.email ?? '',
    profile: profile ?? null,
    timezone,
    preferences: preferences ?? null,
    today: todayInZone(timezone),
  };
}
