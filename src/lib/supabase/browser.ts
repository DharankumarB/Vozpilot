/**
 * Browser-side Supabase client.
 *
 * Client components use this for auth actions (sign in / sign up / sign out) and
 * for realtime reads. It carries only the public anon key; Row Level Security
 * decides what the signed-in user can see.
 */

'use client';

import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Client-component entry point. Never call this from server code. */
export function getBrowserClient() {
  if (!isSupabaseConfigured()) return null;
  if (!client) client = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return client;
}
