import { adminDb } from '@/lib/firebase-admin';
import { apiCreated, apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { audienceFitJobId, audienceFitRequestSchema, createAudienceFitJob } from '@/lib/intelligence/audience-fit-analysis';
import { requireIntelligencePhase } from '@/lib/intelligence/feature-flags';
import { requireIntelligencePreviewUser } from '@/lib/intelligence/preview-access';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { hasFeature, resolveLimits } from '@/lib/stripe/entitlements';
import { withAiOperation } from '@/lib/intelligence/usage';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requireIntelligencePreviewUser(ctx);
    requirePermission(ctx, 'intelligence.analyze');
    const input = audienceFitRequestSchema.parse(await req.json());
    const [product, subscription] = await Promise.all([
      adminDb.doc(`workspaces/${ctx.workspaceId}/products/${input.productId}`).get(),
      getEffectiveSubscription(ctx.uid, ctx.workspaceId),
    ]);
    if (!product.exists) throw new Error('NOT_FOUND');
    await requireIntelligencePhase({ phase: 'foundation', workspaceId: ctx.workspaceId, uid: ctx.uid, entitled: hasFeature(subscription, 'audienceFit') });
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
