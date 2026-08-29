import { adminDb } from '@/lib/firebase-admin';
import { apiCreated, apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { fingerprintRequestSchema } from '@/lib/intelligence/fingerprint-schemas';
import { createFingerprintJob, getCachedFingerprint } from '@/lib/intelligence/fingerprints';
import { requireIntelligencePhase } from '@/lib/intelligence/feature-flags';
import { requireIntelligencePreviewUser } from '@/lib/intelligence/preview-access';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { hasFeature, resolveLimits } from '@/lib/stripe/entitlements';
import { withAiOperation } from '@/lib/intelligence/usage';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requireIntelligencePreviewUser(ctx);
    requirePermission(ctx, 'intelligence.analyze');
    const request = fingerprintRequestSchema.parse(await req.json());
    const [product, subscription] = await Promise.all([
      adminDb.doc(`workspaces/${ctx.workspaceId}/products/${request.productId}`).get(),
      getEffectiveSubscription(ctx.uid, ctx.workspaceId),
    ]);
    if (!product.exists) throw new Error('NOT_FOUND');
    await requireIntelligencePhase({
      phase: 'foundation',
      workspaceId: ctx.workspaceId,
      uid: ctx.uid,
      entitled: hasFeature(subscription, 'audienceFit'),
    });

    const cached = await getCachedFingerprint(ctx.workspaceId, request);
    if (cached) return apiOk({ status: 'complete', cached: true, fingerprint: cached.fingerprint });
    const limits = resolveLimits(subscription);
    // Charged on enqueue, refunded here if the enqueue itself fails and by
    // the executor if the job later fails in the worker (the job carries
    // aiOperationCharged so the worker knows to give it back).
    const job = await withAiOperation(
      {
        workspaceId: ctx.workspaceId,
        uid: ctx.uid,
        monthlyLimit: limits.intelligenceAiOperationsPerMonth,
      },
      () => createFingerprintJob({ workspaceId: ctx.workspaceId, uid: ctx.uid, request }),
    );
    await markWorkspaceDue(ctx.workspaceId, new Date(), 'intelligence_job');
    return apiCreated({ status: 'queued', ...job });
  } catch (error) {
    return apiError(error);
  }
}
