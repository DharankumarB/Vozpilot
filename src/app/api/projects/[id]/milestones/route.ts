import { jsonError, jsonOk, parseBody, requireUser } from '../../../../../lib/api/handler';
import { createMilestoneSchema } from '../../../../../lib/validation/schemas';
import * as repo from '../../../../../lib/db/repositories';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const result = await repo.listProjectMilestones(db, userId, id);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    return jsonOk({ milestones: result.data ?? [] });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const body = await parseBody(request, createMilestoneSchema);
    const project = await repo.getProject(db, userId, id);
    if (!project.data) return jsonError(new Error('That project does not exist.'), 404);

    const result = await repo.createProjectMilestone(db, userId, { ...(body as Record<string, unknown>), project_id: id });
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not create the milestone.'), 500);
    return jsonOk({ milestone: result.data }, { status: 201 });
  } catch (error) {
    return jsonError(error as Error);
  }
}
