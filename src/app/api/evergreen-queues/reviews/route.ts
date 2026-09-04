import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { listEvergreenReviews } from '@/lib/evergreen/storage';
import { requirePermission } from '@/lib/rbac';
import { requireContext } from '@/lib/server-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const schema = z.object({ productId: z.string().trim().min(1).max(200) });

/** Occurrences waiting for a person, across a brand's review-each-run queues. */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `evergreen:${ctx.uid}:${ctx.workspaceId}` });
    requirePermission(ctx, 'evergreen.read');
    const input = schema.parse({ productId: new URL(req.url).searchParams.get('productId') ?? '' });
    const reviews = await listEvergreenReviews(ctx.workspaceId, input.productId);
    return apiOk({ reviews, count: reviews.length });
  } catch (error) {
    return apiError(error);
  }
}
