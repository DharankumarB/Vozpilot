import { jsonError, jsonOk, parseBody, requireUser } from '../../../lib/api/handler';
import { updatePermissionsSchema } from '../../../lib/validation/schemas';
import * as repo from '../../../lib/db/repositories';
import { permissionSummary } from '../../../lib/agent/permissions';

export async function GET() {
  try {
    const { db, userId } = await requireUser();
    const result = await repo.getPermissions(db, userId);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    return jsonOk({ permissions: result.data, summary: permissionSummary(result.data) });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = await parseBody(request, updatePermissionsSchema);
    const result = await repo.upsertPermissions(db, userId, body as never);
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not save AI permissions.'), 500);
    return jsonOk({ permissions: result.data, summary: permissionSummary(result.data) });
  } catch (error) {
    return jsonError(error as Error);
  }
}
