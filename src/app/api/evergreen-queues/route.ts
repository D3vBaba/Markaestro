import { apiCreated, apiError, apiOk } from '@/lib/api-response';
import { createEvergreenQueueSchema } from '@/lib/evergreen/schemas';
import { createEvergreenQueue, listEvergreenQueues } from '@/lib/evergreen/storage';
import { requirePermission } from '@/lib/rbac';
import { requireContext } from '@/lib/server-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `evergreen:${ctx.uid}:${ctx.workspaceId}` });
    requirePermission(ctx, 'evergreen.read');
    const productId = new URL(req.url).searchParams.get('productId') || undefined;
    const queues = await listEvergreenQueues(ctx.workspaceId, productId);
    return apiOk({ queues, count: queues.length });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `evergreen:${ctx.uid}:${ctx.workspaceId}` });
    requirePermission(ctx, 'evergreen.manage');
    const input = createEvergreenQueueSchema.parse(await req.json());
    const queue = await createEvergreenQueue(ctx.workspaceId, ctx.uid, input);
    return apiCreated({ queue });
  } catch (error) {
    return apiError(error);
  }
}
