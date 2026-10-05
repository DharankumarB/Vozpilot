import { jsonError, jsonOk, parseBody, requireUser } from '../../../lib/api/handler';
import { onboardingSchema } from '../../../lib/validation/schemas';
import * as repo from '../../../lib/db/repositories';

/**
 * Onboarding completion.
 *
 * Writes the profile, availability, notification preferences and AI permissions
 * the user chose, then seeds a small number of high-value memories from their
 * stated goals. Nothing is invented - every value comes from the request.
 */
export async function POST(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = await parseBody(request, onboardingSchema);

    if (body.full_name || body.timezone) {
      await repo.updateProfile(db, userId, {
        ...(body.full_name ? { full_name: body.full_name } : {}),
        ...(body.timezone ? { timezone: body.timezone } : {}),
      });
    }

    const preferencePatch: Record<string, unknown> = {};
    if (body.timezone) preferencePatch.timezone = body.timezone;
    if (body.availability) {
      preferencePatch.workday_start = body.availability.workday_start;
      preferencePatch.workday_end = body.availability.workday_end;
      preferencePatch.max_daily_blocks = body.availability.max_daily_blocks;
    }
    if (body.notification_preferences) Object.assign(preferencePatch, body.notification_preferences);
    if (Object.keys(preferencePatch).length > 0) await repo.upsertPreferences(db, userId, preferencePatch as never);

    if (body.ai_permissions) await repo.upsertPermissions(db, userId, body.ai_permissions as never);

    await repo.updateProfile(db, userId, { onboarded_at: new Date().toISOString() });

    const memories: Array<{ category: string; content: string }> = [];
    if (body.working_style?.trim()) {
      memories.push({ category: 'working_style', content: body.working_style.trim() });
    }
    for (const goal of body.main_goals ?? []) {
      memories.push({ category: 'goals', content: `Stated goal: ${goal}` });
    }
    if (body.availability) {
      memories.push({
        category: 'user_preferences',
        content: `Prefers work between ${body.availability.workday_start} and ${body.availability.workday_end} with at most ${body.availability.max_daily_blocks} focus blocks per day.`,
      });
    }

    for (const memory of memories) {
      await repo.createMemory(db, userId, {
        category: memory.category as never,
        content: memory.content,
        importance: 70,
        source: 'onboarding',
      });
    }

    return jsonOk({ onboarded: true });
  } catch (error) {
    return jsonError(error as Error);
  }
}
