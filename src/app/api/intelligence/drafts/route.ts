import { apiCreated, apiError } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';
import { requirePermission } from '@/lib/rbac';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { hasFeature, resolveLimits } from '@/lib/stripe/entitlements';
import { consumeAiOperation, refundAiOperation } from '@/lib/intelligence/usage';
import { checkAndIncrementUsage, refundUsage } from '@/lib/usage';
import { RATE_LIMITS, applyRateLimit } from '@/lib/rate-limit';
import { loadProductIntelligence } from '@/lib/intelligence/product-state';
import {
  buildDraftBrief,
  draftRequestSchema,
  generateIntelligenceDraft,
  loadDraftBrandContext,
  loadDraftSourcePost,
} from '@/lib/intelligence/drafts';

export const runtime = 'nodejs';

/**
 * "Draft this": creates a Draft post in Content from an opportunity, a
 * learning, or an existing measured post. One AI operation per call; the post
 * counts toward the monthly post quota like any other draft.
 */
export async function POST(req: Request) {
  let reservedPostQuota: { uid: string; workspaceId: string } | null = null;
  let chargedAiOperation: string | null = null;
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    requirePermission(ctx, 'intelligence.analyze');
    // After auth so the key is uid-scoped, before any AI operation or post
    // quota is charged so a rate-limited request costs the customer nothing.
    await applyRateLimit(req, RATE_LIMITS.ai, { key: `ai:${ctx.uid}` });
    const request = draftRequestSchema.parse(await req.json());
    const subscription = await getEffectiveSubscription(ctx.uid, ctx.workspaceId);
    await requireIntelligenceAccess(ctx, 'foundation', 'audienceFit', { subscription });
    const [brand, loaded] = await Promise.all([
      loadDraftBrandContext(ctx.workspaceId, request.productId),
      loadProductIntelligence(ctx.workspaceId, request.productId, { allowCached: true }),
    ]);
    const sourcePost = request.source.type === 'post'
      ? await loadDraftSourcePost(ctx.workspaceId, request.productId, request.source.id, loaded.insights)
      : null;
    const brief = buildDraftBrief({ request, insights: loaded.insights, brand, sourcePost });

    const limits = resolveLimits(subscription);
    await consumeAiOperation({
      workspaceId: ctx.workspaceId,
      uid: ctx.uid,
      monthlyLimit: limits.intelligenceAiOperationsPerMonth,
    });
    chargedAiOperation = ctx.workspaceId;
    const quota = await checkAndIncrementUsage(ctx.uid, 'posts', ctx.workspaceId);
    if (!quota.allowed) throw new Error('QUOTA_EXCEEDED_POSTS');
    if (quota.limit !== -1) reservedPostQuota = { uid: ctx.uid, workspaceId: ctx.workspaceId };

    const draft = await generateIntelligenceDraft({
      workspaceId: ctx.workspaceId,
      uid: ctx.uid,
      productId: request.productId,
      brief,
    });
    reservedPostQuota = null;
    chargedAiOperation = null;
    return apiCreated(draft);
  } catch (error) {
    if (reservedPostQuota) {
      await refundUsage(reservedPostQuota.uid, 'posts', 1, reservedPostQuota.workspaceId);
    }
    if (chargedAiOperation) {
      await refundAiOperation({ workspaceId: chargedAiOperation }).catch(() => undefined);
    }
    return apiError(error);
  }
}
