import { redirect } from 'next/navigation';
import { createServerDbClient, isSupabaseConfigured } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';

/** Landing redirect: signed-in users go to the dashboard, everyone else to /login. */
export default async function HomePage() {
  if (!isSupabaseConfigured()) {
    redirect('/login?setup=required');
  }
  const supabase = await createServerDbClient();
  const { data } = await supabase.auth.getUser();
  redirect(data.user ? '/dashboard' : '/login');
}
