import { ApiError, jsonError, jsonOk, parseBody, requireUser } from '../../../lib/api/handler';
import { z } from 'zod';
import * as repo from '../../../lib/db/repositories';

const integrationSchema = z.object({
  provider: z.enum(['calendar', 'email', 'github', 'webhook', 'whatsapp']),
  status: z.enum(['not_configured', 'configured', 'connected', 'error', 'disabled']).optional(),
  display_name: z.string().max(120).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Integrations registry.
 *
 * WhatsApp is intentionally reported as `not_configured` and cannot be enabled
 * from this version. The rest of the app keeps working without any integration.
 */
export async function GET() {
  try {
    const { db, userId } = await requireUser();
    const result = await repo.listIntegrations(db, userId);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    return jsonOk({ integrations: result.data ?? [] });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = await parseBody(request, integrationSchema);

    if (body.provider === 'whatsapp') {
      return jsonError(
        new ApiError('WhatsApp delivery is paused for this version. VozPilot keeps a web-only notification channel.', 409, 'integration_paused'),
      );
    }

    const result = await repo.upsertIntegration(db, userId, body.provider, {
      status: body.status ?? 'not_configured',
      display_name: body.display_name ?? body.provider,
      config: body.config ?? {},
    });
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not save the integration.'), 500);
    return jsonOk({ integration: result.data });
  } catch (error) {
    return jsonError(error as Error);
  }
}
