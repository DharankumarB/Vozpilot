import { jsonError, jsonOk, parseBody, requireUser } from '../../../lib/api/handler';
import { createNotificationSchema } from '../../../lib/validation/schemas';
import * as repo from '../../../lib/db/repositories';
import { emitNotification } from '../../../lib/notifications/service';

export async function GET(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const url = new URL(request.url);
    const result = await repo.listNotifications(db, userId, {
      unreadOnly: url.searchParams.get('unread') === '1',
      category: url.searchParams.get('category') ?? undefined,
      limit: Number.parseInt(url.searchParams.get('limit') ?? '50', 10),
    });
    if (result.error) return jsonError(new Error(result.error.message), 500);
    const notifications = result.data ?? [];
    return jsonOk({ notifications, unreadCount: notifications.filter((item) => !item.read_at).length });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = await parseBody(request, createNotificationSchema);
    const preferences = await repo.getPreferences(db, userId);
    const result = await emitNotification(db, userId, body, preferences.data);
    if (!result.created) {
      return jsonOk({ created: false, skipped: result.skipped, reason: result.reason });
    }
    return jsonOk({ notification: result.created }, { status: 201 });
  } catch (error) {
    return jsonError(error as Error);
  }
}
