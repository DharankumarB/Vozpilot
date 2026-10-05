import { redirect } from 'next/navigation';
import { createServerDbClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { AppShell } from '@/components/AppShell';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Application shell layout.
 *
 * The user is resolved server-side from the session. Client-supplied identity is
 * never trusted, so the shell always renders the authenticated user's own data.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    redirect('/login?setup=required');
  }

  const supabase = await createServerDbClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login?next=/dashboard');

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  const typedProfile = profile as Profile | null;

  if (!typedProfile?.onboarded_at) redirect('/onboarding');

  return (
    <AppShell
      user={{
        email: user.email ?? '',
        fullName: typedProfile?.full_name ?? user.user_metadata?.full_name ?? '',
        avatarUrl: typedProfile?.avatar_url ?? null,
      }}
    >
      {children}
    </AppShell>
  );
}
