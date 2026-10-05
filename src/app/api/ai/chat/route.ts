import { jsonError, jsonOk, parseBody, requireUser } from '../../../../lib/api/handler';
import { aiChatSchema } from '../../../../lib/validation/schemas';
import { runVozCore } from '../../../../lib/agent/vozcore';

/**
 * VozCore chat endpoint.
 *
 * The provider never receives database credentials and never writes directly.
 * It emits tool calls; this route validates, permission-checks and executes them.
 */
export async function POST(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = await parseBody(request, aiChatSchema);

    const profile = await db.from('profiles').select('timezone').eq('id', userId).maybeSingle();
    const timezone = (profile.data as { timezone?: string } | null)?.timezone ?? 'UTC';

    const result = await runVozCore({
      db,
      userId,
      message: body.message,
      timezone,
      conversationId: body.conversation_id,
      confirmed: body.confirmed === true,
    });

    return jsonOk({
      reply: result.reply,
      actions: result.actions,
      conversationId: result.conversationId,
      clarification: result.clarification,
      pendingConfirmation: result.pendingConfirmation,
      provider: result.provider,
      stopped: result.stopped,
    });
  } catch (error) {
    return jsonError(error as Error);
  }
}
