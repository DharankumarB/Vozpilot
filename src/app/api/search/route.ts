import { jsonError, jsonOk, requireUser } from '../../../lib/api/handler';
import { searchSchema } from '../../../lib/validation/schemas';
import * as repo from '../../../lib/db/repositories';

/** Global search across goals, projects, tasks and inbox - user-scoped only. */
export async function GET(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const url = new URL(request.url);
    const parsed = searchSchema.safeParse({
      q: url.searchParams.get('q') ?? '',
      limit: Number.parseInt(url.searchParams.get('limit') ?? '10', 10),
    });
    if (!parsed.success) return jsonError(new Error('Enter a search term.'), 422);

    const result = await repo.globalSearch(db, userId, parsed.data.q, parsed.data.limit);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    return jsonOk({ query: parsed.data.q, ...(result.data ?? { goals: [], projects: [], tasks: [], inboxItems: [] }) });
  } catch (error) {
    return jsonError(error as Error);
  }
}
