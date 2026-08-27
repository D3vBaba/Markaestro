import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { apiCreated, apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { createTrackingCode } from '@/lib/intelligence/conversions';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';

const createSchema = z.object({
  productId: z.string().min(1).max(128),
  destination: z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
  label: z.string().min(1).max(160),
  campaignId: z.string().max(128).optional(),
  socialPostId: z.string().max(128).optional(),
});

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'intelligence.read');
    await requireIntelligenceAccess(ctx, 'learning', 'intelligenceOptimization');
    const productId = new URL(req.url).searchParams.get('productId');
    const collection = adminDb.collection(`workspaces/${ctx.workspaceId}/trackedLinks`);
    const snapshot = await (productId ? collection.where('productId', '==', productId) : collection).limit(200).get();
    return apiOk({ links: snapshot.docs.map((doc) => doc.data()) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'conversions.manage');
    await requireIntelligenceAccess(ctx, 'learning', 'intelligenceOptimization');
    const input = createSchema.parse(await req.json());
    const product = await adminDb.doc(`workspaces/${ctx.workspaceId}/products/${input.productId}`).get();
    if (!product.exists) throw new Error('NOT_FOUND');
    const code = createTrackingCode();
    const now = new Date().toISOString();
    const data = { code, ...input, workspaceId: ctx.workspaceId, active: true, createdBy: ctx.uid, createdAt: now, updatedAt: now };
    const batch = adminDb.batch();
    batch.create(adminDb.doc(`trackedLinks/${code}`), data);
    batch.create(adminDb.doc(`workspaces/${ctx.workspaceId}/trackedLinks/${code}`), data);
    await batch.commit();
    return apiCreated({ link: data, path: `/r/${code}` });
  } catch (error) {
    return apiError(error);
  }
}
