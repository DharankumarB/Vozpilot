import { jsonError, jsonOk, requireUser } from '../../../../lib/api/handler';
import * as repo from '../../../../lib/db/repositories';

export async function POST() {
  try {
    const { db, userId } = await requireUser();
    const result = await repo.markAllNotificationsRead(db, userId);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    return jsonOk({ markedAllRead: true });
  } catch (error) {
    return jsonError(error as Error);
  }
}
