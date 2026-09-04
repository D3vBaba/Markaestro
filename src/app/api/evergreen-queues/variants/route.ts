import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { requirePermission } from '@/lib/rbac';
import { requireContext } from '@/lib/server-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { getEffectiveLimits } from '@/lib/stripe/entitlements';
import { withAiOperation } from '@/lib/intelligence/usage';
import { loadDraftBrandContext } from '@/lib/intelligence/drafts';
import { evaluateEvergreenEligibility } from '@/lib/evergreen/eligibility';
import { generateEvergreenVariants } from '@/lib/evergreen/variants';

const schema = z.object({ sourcePostId: z.string().trim().min(1).max(200) });

/**
 * Four rewrites of a proven caption in the brand's voice, for the user to
 * tick into an Evergreen queue. One AI operation per call, refunded if the
 * model call fails.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'evergreen.manage');
    await applyRateLimit(req, RATE_LIMITS.ai, { key: `ai:${ctx.uid}` });
    const input = schema.parse(await req.json());
    const snap = await adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${input.sourcePostId}`).get();
    if (!snap.exists) throw new Error('NOT_FOUND');
    const post = snap.data() as Record<string, unknown>;
    const productId = typeof post.productId === 'string' ? post.productId : '';
    if (!productId) throw new Error('NOT_FOUND');
    const source = typeof post.content === 'string' ? post.content.trim() : '';
    if (!source) throw new Error('VALIDATION_EVERGREEN_SOURCE_NO_CAPTION');
    const channels = evaluateEvergreenEligibility(post).channels;
    const [brand, limits] = await Promise.all([
      loadDraftBrandContext(ctx.workspaceId, productId),
      getEffectiveLimits(ctx.uid, ctx.workspaceId),
    ]);
    const result = await withAiOperation(
      { workspaceId: ctx.workspaceId, uid: ctx.uid, monthlyLimit: limits.intelligenceAiOperationsPerMonth },
      () => generateEvergreenVariants({ source, channels: channels.length > 0 ? channels : ['instagram'], brand }),
    );
    return apiOk({ variants: result.variants, model: result.model });
  } catch (error) {
    return apiError(error);
  }
}
