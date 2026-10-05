import { jsonError, jsonOk, requireUser } from '../../../lib/api/handler';
import * as repo from '../../../lib/db/repositories';

export async function GET(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const url = new URL(request.url);
    const agent = url.searchParams.get('agent') ?? undefined;
    const tool = url.searchParams.get('tool') ?? undefined;
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10);

    const [actions, runs] = await Promise.all([
      repo.listAgentActions(db, userId, { agent, tool, limit }),
      repo.listAgentActions(db, userId, { limit: 0 }),
    ]);
    void runs;

    if (actions.error) return jsonError(new Error(actions.error.message), 500);

    const agentList = ['vozcore', 'vozgoal', 'vozproject', 'vozday', 'vozinbox'];
    return jsonOk({
      actions: actions.data ?? [],
      availableAgents: agentList,
      stats: agentList.map((name) => ({
        agent: name,
        count: (actions.data ?? []).filter((action) => action.agent === name).length,
      })),
    });
  } catch (error) {
    return jsonError(error as Error);
  }
}
