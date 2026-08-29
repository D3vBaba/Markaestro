import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { audienceIntelligenceProfileSchema } from '@/lib/intelligence/schemas';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';

export const runtime = 'nodejs';

function refs(workspaceId: string, productId: string) {
  const product = adminDb.doc(`${workspaceCollection(workspaceId, 'products')}/${productId}`);
  return { product, profile: product.collection('intelligence').doc('profile') };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'intelligence.read');
    await requireIntelligenceAccess(ctx, 'foundation', 'audienceFit');
    const { id } = await params;
    const { product, profile } = refs(ctx.workspaceId, id);
    const [productSnapshot, profileSnapshot] = await Promise.all([product.get(), profile.get()]);
    if (!productSnapshot.exists) throw new Error('NOT_FOUND');
    return apiOk({
      productId: id,
      profile: profileSnapshot.exists ? profileSnapshot.data() : null,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'intelligence.manage');
    await requireIntelligenceAccess(ctx, 'foundation', 'audienceFit');
    const { id } = await params;
    const parsed = audienceIntelligenceProfileSchema.parse(await req.json());
    const { product, profile } = refs(ctx.workspaceId, id);
    if (!(await product.get()).exists) throw new Error('NOT_FOUND');
    const now = new Date().toISOString();
    const payload = {
      ...parsed,
      productId: id,
      workspaceId: ctx.workspaceId,
      updatedAt: now,
      updatedBy: ctx.uid,
    };
    await profile.set(payload, { merge: true });
    return apiOk({ productId: id, profile: payload });
  } catch (error) {
    return apiError(error);
  }
}

