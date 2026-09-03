import { apiError, apiOk } from '@/lib/api-response';
import { evergreenQueueIdSchema } from '@/lib/evergreen/schemas';
import { listEvergreenRuns } from '@/lib/evergreen/storage';
import { requirePermission } from '@/lib/rbac';
import { requireContext } from '@/lib/server-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `evergreen:${ctx.uid}:${ctx.workspaceId}` });
    requirePermission(ctx, 'evergreen.read');
    const id = evergreenQueueIdSchema.parse((await params).id);
    const runs = await listEvergreenRuns(ctx.workspaceId, id);
    return apiOk({ runs, count: runs.length });
  } catch (error) {
    return apiError(error);
  }
}
