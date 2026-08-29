import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';
import { requirePermission } from '@/lib/rbac';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { intelligencePhaseFlags, loadProductIntelligence } from '@/lib/intelligence/product-state';

const querySchema = z.object({ productId: z.string().min(1).max(128) });

/**
 * Light read for the composer: best posting windows only, served from the
 * insights cache so opening the composer never re-reads the post history.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'intelligence.read');
    const subscription = await getEffectiveSubscription(ctx.uid, ctx.workspaceId);
    await requireIntelligenceAccess(ctx, 'foundation', 'audienceFit', { subscription });
    const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const [phases, loaded] = await Promise.all([
      intelligencePhaseFlags(ctx),
      loadProductIntelligence(ctx.workspaceId, query.productId, { allowCached: true }),
    ]);
    return apiOk({
      productId: query.productId,
      objective: loaded.insights.objective,
      timing: phases.learning ? loaded.insights.timing : null,
      readiness: {
        datedPosts: loaded.insights.readiness.datedPosts,
        objectiveMeasured: loaded.insights.readiness.objectiveMeasured,
      },
      computedAt: loaded.computedAt,
    });
  } catch (error) {
    return apiError(error);
  }
}
