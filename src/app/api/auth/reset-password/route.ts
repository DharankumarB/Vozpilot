import { createRouteAuthClient, isSupabaseConfigured } from '../../../../lib/supabase/client';
import { jsonError, jsonOk, parseBody } from '../../../../lib/api/handler';
import { resetPasswordSchema } from '../../../../lib/validation/schemas';

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) {
      return jsonError(new Error('VozPilot is not connected to a database yet. Configure Supabase to continue.'), 503);
    }
    const body = await parseBody(request, resetPasswordSchema);
    const supabase = await createRouteAuthClient();

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      return jsonError(new Error('Your reset link has expired. Request a new one.'), 401);
    }

    const { error } = await supabase.auth.updateUser({ password: body.password });
    if (error) {
      return jsonError(new Error('We could not update your password. Please request a new reset link.'), 400);
    }

    return jsonOk({ updated: true, message: 'Password updated. You can now sign in.' });
  } catch (error) {
    return jsonError(error as Error);
  }
}
