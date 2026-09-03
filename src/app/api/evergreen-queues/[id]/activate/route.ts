import { apiError, apiOk, authoredError } from '@/lib/api-response';
import { evergreenQueueIdSchema } from '@/lib/evergreen/schemas';
import { activateEvergreenQueue } from '@/lib/evergreen/storage';
import { requirePermission } from '@/lib/rbac';
import { requireContext } from '@/lib/server-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `evergreen:${ctx.uid}:${ctx.workspaceId}` });
    requirePermission(ctx, 'evergreen.manage');
    if (!ctx.emailVerified) {
      return authoredError('EMAIL_NOT_VERIFIED', 'Verify your email to activate Intelligent Evergreen.', { status: 403 });
    }
    const id = evergreenQueueIdSchema.parse((await params).id);
    return apiOk({ queue: await activateEvergreenQueue(ctx.workspaceId, id, ctx.uid) });
  } catch (error) {
    return apiError(error);
  }
}
