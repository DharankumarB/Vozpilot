import { createRouteAuthClient, isSupabaseConfigured } from '../../../../lib/supabase/client';
import { jsonError, jsonOk } from '../../../../lib/api/handler';

export async function POST() {
  try {
    if (isSupabaseConfigured()) {
      const supabase = await createRouteAuthClient();
      await supabase.auth.signOut();
    }
    return jsonOk({ signedOut: true });
  } catch (error) {
    return jsonError(error as Error);
  }
}
