import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { recommendationDecisionSchema } from '@/lib/intelligence/management-schemas';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';
import { loadProductIntelligence } from '@/lib/intelligence/product-state';

/**
 * Records a decision on a recommendation. `proposed` undoes an earlier
 * decision. Nothing here publishes, schedules, or edits drafts.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'intelligence.analyze');
    await requireIntelligenceAccess(ctx, 'growth', 'intelligenceOptimization');
    const { id } = await params;
    const { decision } = recommendationDecisionSchema.parse(await req.json());
    const productId = new URL(req.url).searchParams.get('productId') || '';
    if (!productId) throw new Error('VALIDATION_PRODUCT_REQUIRED');
    const loaded = await loadProductIntelligence(ctx.workspaceId, productId, { allowCached: true });
    const record = loaded.insights.opportunities.find((item) => item.id === id);
    if (!record) throw new Error('NOT_FOUND');
    const now = new Date().toISOString();
    await adminDb.doc(`workspaces/${ctx.workspaceId}/optimizationRecommendations/${id}`).set({
      ...record,
      workspaceId: ctx.workspaceId,
      status: decision,
      decidedAt: now,
      decidedBy: ctx.uid,
      updatedAt: now,
    }, { merge: true });
    return apiOk({ id, decision });
  } catch (error) { return apiError(error); }
}
