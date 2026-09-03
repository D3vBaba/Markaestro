import { apiError, apiOk } from '@/lib/api-response';
import { evergreenQueueIdSchema } from '@/lib/evergreen/schemas';
import { resumeEvergreenQueue } from '@/lib/evergreen/storage';
import { requirePermission } from '@/lib/rbac';
import { requireContext } from '@/lib/server-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `evergreen:${ctx.uid}:${ctx.workspaceId}` });
    requirePermission(ctx, 'evergreen.manage');
    const id = evergreenQueueIdSchema.parse((await params).id);
    return apiOk({ queue: await resumeEvergreenQueue(ctx.workspaceId, id, ctx.uid) });
  } catch (error) {
    return apiError(error);
  }
}
