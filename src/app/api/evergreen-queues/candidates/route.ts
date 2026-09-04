import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { listEvergreenCandidates } from '@/lib/evergreen/candidates';
import { requirePermission } from '@/lib/rbac';
import { requireContext } from '@/lib/server-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const schema = z.object({ productId: z.string().trim().min(1).max(200) });

/**
 * Published posts of one brand ranked as evergreen sources: the strongest
 * measured posts first (flagged `suggested`), then the rest with the reasons
 * they are not eligible yet. Feeds the source picker in the Evergreen tab.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `evergreen:${ctx.uid}:${ctx.workspaceId}` });
    requirePermission(ctx, 'evergreen.read');
    const input = schema.parse({ productId: new URL(req.url).searchParams.get('productId') ?? '' });
    return apiOk({ candidates: await listEvergreenCandidates(ctx.workspaceId, input.productId) });
  } catch (error) {
    return apiError(error);
  }
}
