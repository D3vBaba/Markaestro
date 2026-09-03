import { apiError, apiOk } from '@/lib/api-response';
import { evergreenQueueIdSchema, updateEvergreenQueueSchema } from '@/lib/evergreen/schemas';
import { archiveEvergreenQueue, getEvergreenQueue, updateEvergreenQueue } from '@/lib/evergreen/storage';
import { requirePermission } from '@/lib/rbac';
import { requireContext } from '@/lib/server-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `evergreen:${ctx.uid}:${ctx.workspaceId}` });
    requirePermission(ctx, 'evergreen.read');
    const id = evergreenQueueIdSchema.parse((await params).id);
    return apiOk({ queue: await getEvergreenQueue(ctx.workspaceId, id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `evergreen:${ctx.uid}:${ctx.workspaceId}` });
    requirePermission(ctx, 'evergreen.manage');
    const id = evergreenQueueIdSchema.parse((await params).id);
    const input = updateEvergreenQueueSchema.parse(await req.json());
    return apiOk({ queue: await updateEvergreenQueue(ctx.workspaceId, id, ctx.uid, input) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `evergreen:${ctx.uid}:${ctx.workspaceId}` });
    requirePermission(ctx, 'evergreen.manage');
    const id = evergreenQueueIdSchema.parse((await params).id);
    return apiOk({ queue: await archiveEvergreenQueue(ctx.workspaceId, id, ctx.uid) });
  } catch (error) {
    return apiError(error);
  }
}
