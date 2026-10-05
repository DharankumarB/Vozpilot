/**
 * Supabase clients.
 *
 * - `createRouteAuthClient` / `createServerDbClient` are used by API routes and
 *   server components. They are bound to the request cookies, so `auth.uid()`
 *   inside RLS policies always resolves to the signed-in user.
 * - `createAdminClient` uses the service-role key and BYPASSES RLS. It is only
 *   reachable from server code (cron / briefing fan-out) and is never imported
 *   by client components. `server-only` enforces that at build time.
 *
 * The browser bundle only ever receives the public anon key.
 */

import { createServerClient as createSsrServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import 'server-only';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export type SupabaseDbClient = ReturnType<typeof createSupabaseClient>;

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

function assertConfigured(): void {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment.',
    );
  }
}

function cookieAdapter() {
  return {
    async getAll() {
      const { cookies } = await import('next/headers');
      const store = await cookies();
      return store.getAll();
    },
    async setAll(
      cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>,
    ) {
      try {
        const { cookies } = await import('next/headers');
        const store = await cookies();
        for (const { name, value, options } of cookiesToSet) {
          store.set(name, value, options as never);
        }
      } catch {
        // Server Components cannot set cookies; the middleware refreshes the
        // session cookie instead, which is the supported path.
      }
    },
  };
}

/**
 * Request-scoped client carrying the caller's session. Use for auth flows and
 * for every database read/write performed on behalf of a user.
 */
export async function createRouteAuthClient() {
  assertConfigured();
  return createSsrServerClient(supabaseUrl, supabaseAnonKey, { cookies: cookieAdapter() });
}

export async function createServerDbClient(): Promise<SupabaseDbClient> {
  return (await createRouteAuthClient()) as unknown as SupabaseDbClient;
}

let adminClient: SupabaseDbClient | null = null;

/** Service-role client. SERVER ONLY - bypasses RLS. Use with extreme care. */
export function createAdminClient(): SupabaseDbClient {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  }
  if (!adminClient) {
    adminClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}
