import { createRouteAuthClient, isSupabaseConfigured } from '../../../../lib/supabase/client';
import { jsonError, jsonOk, parseBody } from '../../../../lib/api/handler';
import { loginSchema } from '../../../../lib/validation/schemas';

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) {
      return jsonError(new Error('VozPilot is not connected to a database yet. Configure Supabase to continue.'), 503);
    }
    const body = await parseBody(request, loginSchema);
    const supabase = await createRouteAuthClient();

    const { data, error } = await supabase.auth.signInWithPassword({ email: body.email, password: body.password });

    if (error || !data.user) {
      return jsonError(new Error('Those credentials do not match an account. Please try again.'), 401);
    }

    const profile = await supabase.from('profiles').select('onboarded_at, full_name, timezone').eq('id', data.user.id).maybeSingle();

    return jsonOk({
      signedIn: true,
      onboarded: Boolean(profile.data?.onboarded_at),
      redirect: profile.data?.onboarded_at ? '/dashboard' : '/onboarding',
    });
  } catch (error) {
    return jsonError(error as Error);
  }
}
