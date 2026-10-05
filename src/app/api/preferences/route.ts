import { jsonError, jsonOk, parseBody, requireUser } from '../../../lib/api/handler';
import { updatePreferencesSchema } from '../../../lib/validation/schemas';
import * as repo from '../../../lib/db/repositories';

export async function GET() {
  try {
    const { db, userId } = await requireUser();
    const result = await repo.getPreferences(db, userId);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    return jsonOk({ preferences: result.data });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = await parseBody(request, updatePreferencesSchema);
    if (body.workday_start && body.workday_end && body.workday_start >= body.workday_end) {
      return jsonError(new Error('Your workday end time must be after the start time.'), 422);
    }
    const result = await repo.upsertPreferences(db, userId, body as never);
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not save your preferences.'), 500);
    return jsonOk({ preferences: result.data });
  } catch (error) {
    return jsonError(error as Error);
  }
}
