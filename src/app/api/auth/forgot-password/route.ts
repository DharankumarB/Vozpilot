import { createRouteAuthClient, isSupabaseConfigured } from '../../../../lib/supabase/client';
import { jsonError, jsonOk, parseBody } from '../../../../lib/api/handler';
import { forgotPasswordSchema } from '../../../../lib/validation/schemas';

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) {
      return jsonError(new Error('VozPilot is not connected to a database yet. Configure Supabase to continue.'), 503);
    }
    const body = await parseBody(request, forgotPasswordSchema);
    const supabase = await createRouteAuthClient();
    const origin = new URL(request.url).origin;

    await supabase.auth.resetPasswordForEmail(body.email, {
      redirectTo: `${origin}/reset-password`,
    });

    // Always report success: confirming whether an email exists would leak accounts.
    return jsonOk({ sent: true, message: 'If an account exists for that email, a reset link is on its way.' });
  } catch (error) {
    return jsonError(error as Error);
  }
}
