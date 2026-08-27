import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { recommendationDecisionSchema } from '@/lib/intelligence/management-schemas';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';
import { loadProductIntelligence } from '@/lib/intelligence/product-state';

async function decide(
  collection: 'brandLearnings' | 'optimizationRecommendations',
  phase: 'learning' | 'growth',
  req: Request,
  id: string,
) {
  const ctx = await requireContext(req);
  requirePermission(ctx, 'intelligence.analyze');
  await requireIntelligenceAccess(ctx, phase, 'intelligenceOptimization');
  const { decision } = recommendationDecisionSchema.parse(await req.json());
  const productId = new URL(req.url).searchParams.get('productId') || '';
  if (!productId) throw new Error('VALIDATION_PRODUCT_REQUIRED');
  const loaded = await loadProductIntelligence(ctx.workspaceId, productId);
  const record = collection === 'brandLearnings'
    ? loaded.insights.learnings.find((item) => item.id === id)
    : loaded.insights.opportunities.find((item) => item.id === id);
  if (!record) throw new Error('NOT_FOUND');
  const now = new Date().toISOString();
  await adminDb.doc(`workspaces/${ctx.workspaceId}/${collection}/${id}`).set({
    ...record,
    workspaceId: ctx.workspaceId,
    status: decision,
    decidedAt: now,
    decidedBy: ctx.uid,
    updatedAt: now,
  }, { merge: true });
  return { id, decision };
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return apiOk(await decide('optimizationRecommendations', 'growth', req, id));
  } catch (error) { return apiError(error); }
}
