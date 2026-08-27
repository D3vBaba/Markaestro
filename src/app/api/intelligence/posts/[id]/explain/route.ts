import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { requireIntelligencePhase } from '@/lib/intelligence/feature-flags';
import { requireIntelligencePreviewUser } from '@/lib/intelligence/preview-access';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { hasFeature, resolveLimits } from '@/lib/stripe/entitlements';
import { consumeAiOperation, refundAiOperation } from '@/lib/intelligence/usage';
import { loadProductIntelligence } from '@/lib/intelligence/product-state';
import { explainPostPerformance } from '@/lib/intelligence/explanations';

export const runtime = 'nodejs';

const bodySchema = z.object({
  productId: z.string().min(1).max(128),
  locale: z.string().max(12).optional(),
});

/**
 * "Why it worked" for one measured post. Cached on the post; an AI operation
 * is charged only when a fresh explanation has to be generated.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let chargedAiOperation: string | null = null;
  try {
    const ctx = await requireContext(req);
    requireIntelligencePreviewUser(ctx);
    requirePermission(ctx, 'intelligence.analyze');
    const { id } = await params;
    const body = bodySchema.parse(await req.json());
    const subscription = await getEffectiveSubscription(ctx.uid, ctx.workspaceId);
    await requireIntelligencePhase({
      phase: 'foundation',
      workspaceId: ctx.workspaceId,
      uid: ctx.uid,
      entitled: hasFeature(subscription, 'audienceFit'),
    });
    const loaded = await loadProductIntelligence(ctx.workspaceId, body.productId, { allowCached: true });
    const limits = resolveLimits(subscription);
    const result = await explainPostPerformance({
      workspaceId: ctx.workspaceId,
      uid: ctx.uid,
      productId: body.productId,
      socialPostId: id,
      insights: loaded.insights,
      locale: body.locale,
      beforeGenerate: () => consumeAiOperation({
        workspaceId: ctx.workspaceId,
        uid: ctx.uid,
        monthlyLimit: limits.intelligenceAiOperationsPerMonth,
      }).then(() => {
        chargedAiOperation = ctx.workspaceId;
      }),
    });
    return apiOk(result);
  } catch (error) {
    if (chargedAiOperation) {
      await refundAiOperation({ workspaceId: chargedAiOperation }).catch(() => undefined);
    }
    return apiError(error);
  }
}
