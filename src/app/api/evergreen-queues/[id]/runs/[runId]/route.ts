import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { evergreenQueueIdSchema } from '@/lib/evergreen/schemas';
import { approveEvergreenRun, skipEvergreenRun } from '@/lib/evergreen/storage';
import { requirePermission } from '@/lib/rbac';
import { requireContext } from '@/lib/server-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const schema = z.object({ action: z.enum(['approve', 'skip']) });

/** Review decision on one occurrence: approve puts it on the calendar, skip drops it. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `evergreen:${ctx.uid}:${ctx.workspaceId}` });
    requirePermission(ctx, 'evergreen.manage');
    const { id, runId } = await params;
    const queueId = evergreenQueueIdSchema.parse(id);
    const input = schema.parse(await req.json());
    const result = input.action === 'approve'
      ? await approveEvergreenRun(ctx.workspaceId, queueId, evergreenQueueIdSchema.parse(runId), ctx.uid)
      : await skipEvergreenRun(ctx.workspaceId, queueId, evergreenQueueIdSchema.parse(runId), ctx.uid);
    return apiOk({ action: input.action, ...result });
  } catch (error) {
    return apiError(error);
  }
}
