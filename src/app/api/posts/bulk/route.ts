import { apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { applyBulkPostOperation } from '@/lib/social/bulk-post-operations';
import { bulkPostOperationSchema } from '@/lib/social/bulk-post-schema';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * Reschedule, delete, or change the status of up to 25 posts in one call.
 *
 * Answers 200 whenever anything succeeded, with the per-post outcome in the
 * body, and only fails the whole request when every item failed. An agency
 * moving a week of posts needs to know which three did not move, not to have
 * the other twenty-two rolled back because of them.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    const input = bulkPostOperationSchema.parse(await req.json());

    const result = await applyBulkPostOperation(ctx.workspaceId, ctx.uid, input.ids, input);

    if (result.succeeded.length === 0) {
      logger.warn('bulk post operation failed for every item', {
        event: 'posts.bulk.all_failed',
        workspaceId: ctx.workspaceId,
        action: input.action,
        count: input.ids.length,
      });
      return apiOk({ error: 'VALIDATION_ERROR', ...result }, 400);
    }

    return apiOk(result);
  } catch (error) {
    return apiError(error);
  }
}
