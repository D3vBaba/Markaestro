import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';
import { requirePermission } from '@/lib/rbac';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { resolveLimits } from '@/lib/stripe/entitlements';
import { consumeAiOperation, refundAiOperation } from '@/lib/intelligence/usage';
import { loadProductIntelligence } from '@/lib/intelligence/product-state';
import { explainPostPerformance } from '@/lib/intelligence/explanations';
import { RATE_LIMITS, applyRateLimit } from '@/lib/rate-limit';

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
    requirePermission(ctx, 'intelligence.analyze');
    // After auth so the key is uid-scoped, before any AI operation is charged
    // so a rate-limited request costs the customer nothing.
    await applyRateLimit(req, RATE_LIMITS.ai, { key: `ai:${ctx.uid}` });
    const { id } = await params;
    const body = bodySchema.parse(await req.json());
    const subscription = await getEffectiveSubscription(ctx.uid, ctx.workspaceId);
    await requireIntelligenceAccess(ctx, 'foundation', 'audienceFit', { subscription });
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
