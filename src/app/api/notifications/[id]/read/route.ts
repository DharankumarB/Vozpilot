import { jsonError, jsonOk, requireUser } from '../../../../../lib/api/handler';
import * as repo from '../../../../../lib/db/repositories';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const result = await repo.markNotificationRead(db, userId, id);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    if (!result.data) return jsonError(new Error('That notification does not exist.'), 404);
    return jsonOk({ notification: result.data });
  } catch (error) {
    return jsonError(error as Error);
  }
}
