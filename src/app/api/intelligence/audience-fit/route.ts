import { adminDb } from '@/lib/firebase-admin';
import { apiCreated, apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';
import { requirePermission } from '@/lib/rbac';
import { audienceFitJobId, audienceFitRequestSchema, createAudienceFitJob } from '@/lib/intelligence/audience-fit-analysis';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { hasFeature, resolveLimits } from '@/lib/stripe/entitlements';
import { withAiOperation } from '@/lib/intelligence/usage';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';
import { RATE_LIMITS, applyRateLimit } from '@/lib/rate-limit';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'intelligence.analyze');
    // After auth so the key is uid-scoped, before any AI operation is charged
    // so a rate-limited request costs the customer nothing.
    await applyRateLimit(req, RATE_LIMITS.ai, { key: `ai:${ctx.uid}` });
    const input = audienceFitRequestSchema.parse(await req.json());
    const [product, subscription] = await Promise.all([
      adminDb.doc(`workspaces/${ctx.workspaceId}/products/${input.productId}`).get(),
      getEffectiveSubscription(ctx.uid, ctx.workspaceId),
    ]);
    if (!product.exists) throw new Error('NOT_FOUND');
    await requireIntelligenceAccess(ctx, 'foundation', 'audienceFit', { subscription });
    const existingId = audienceFitJobId(ctx.workspaceId, input);
    const existingSnapshot = await adminDb.doc(`workspaces/${ctx.workspaceId}/intelligenceJobs/${existingId}`).get();
    if (existingSnapshot.exists && existingSnapshot.data()?.status === 'complete') {
      return apiOk({ jobId: existingId, status: 'complete', result: existingSnapshot.data()?.result });
    }
    if (existingSnapshot.exists && ['queued', 'running'].includes(String(existingSnapshot.data()?.status))) {
      return apiOk({ jobId: existingId, status: existingSnapshot.data()?.status });
    }
    const existing = await withAiOperation(
      { workspaceId: ctx.workspaceId, uid: ctx.uid, monthlyLimit: resolveLimits(subscription).intelligenceAiOperationsPerMonth },
      () => createAudienceFitJob({ workspaceId: ctx.workspaceId, uid: ctx.uid, request: input }),
    );
    await markWorkspaceDue(ctx.workspaceId, new Date(), 'intelligence_job');
    return apiCreated(existing);
  } catch (error) {
    return apiError(error);
  }
}
