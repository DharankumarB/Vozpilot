import { createRouteAuthClient, isSupabaseConfigured } from '../../../../lib/supabase/client';
import { jsonError, jsonOk, parseBody } from '../../../../lib/api/handler';
import { signupSchema } from '../../../../lib/validation/schemas';

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) {
      return jsonError(new Error('VozPilot is not connected to a database yet. Configure Supabase to continue.'), 503);
    }
    const body = await parseBody(request, signupSchema);
    const supabase = await createRouteAuthClient();

    const { data, error } = await supabase.auth.signUp({
      email: body.email,
      password: body.password,
      options: {
        data: { full_name: body.full_name, timezone: body.timezone },
        emailRedirectTo: `${new URL(request.url).origin}/login?verified=1`,
      },
    });

    if (error) {
      const message = /already registered|already exists/i.test(error.message)
        ? 'An account with that email already exists. Try signing in instead.'
        : 'We could not create your account. Please check the details and try again.';
      return jsonError(new Error(message), 400);
    }

    // When email confirmation is disabled the session is returned immediately.
    if (!data.session) {
      return jsonOk({
        created: true,
        needsEmailConfirmation: true,
        message: 'Account created. Check your inbox to confirm your email address, then sign in.',
      });
    }

    return jsonOk({ created: true, needsEmailConfirmation: false, message: 'Account created. Welcome to VozPilot.' });
  } catch (error) {
    return jsonError(error as Error);
  }
}
