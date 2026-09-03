import { apiError, apiOk } from '@/lib/api-response';
import { getEvergreenQueueAnalytics } from '@/lib/evergreen/analytics';
import { evergreenQueueIdSchema } from '@/lib/evergreen/schemas';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { requirePermission } from '@/lib/rbac';
import { requireContext } from '@/lib/server-auth';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `evergreen:${ctx.uid}:${ctx.workspaceId}` });
    requirePermission(ctx, 'evergreen.read');
    const id = evergreenQueueIdSchema.parse((await params).id);
    return apiOk({ analytics: await getEvergreenQueueAnalytics(ctx.workspaceId, id) });
  } catch (error) {
    return apiError(error);
  }
}
