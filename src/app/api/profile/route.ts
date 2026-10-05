import { jsonError, jsonOk, parseBody, requireUser } from '../../../lib/api/handler';
import { updateProfileSchema } from '../../../lib/validation/schemas';
import * as repo from '../../../lib/db/repositories';

export async function GET() {
  try {
    const { db, userId, email } = await requireUser();
    const result = await repo.getProfile(db, userId);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    return jsonOk({ profile: result.data, email });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = await parseBody(request, updateProfileSchema);
    const result = await repo.updateProfile(db, userId, body as never);
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not save your profile.'), 500);

    // Keep the scheduling timezone in sync with the profile timezone.
    if (body.timezone) await repo.upsertPreferences(db, userId, { timezone: body.timezone });

    return jsonOk({ profile: result.data });
  } catch (error) {
    return jsonError(error as Error);
  }
}
