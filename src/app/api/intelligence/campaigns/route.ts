import { randomUUID } from 'node:crypto';
import { apiCreated, apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { campaignSchema } from '@/lib/intelligence/management-schemas';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req); requirePermission(ctx, 'intelligence.read'); await requireIntelligenceAccess(ctx, 'growth', 'intelligenceOptimization');
    const snapshot = await adminDb.collection(`workspaces/${ctx.workspaceId}/campaigns`).limit(200).get();
    return apiOk({ campaigns: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
  } catch (error) { return apiError(error); }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req); requirePermission(ctx, 'intelligence.manage'); await requireIntelligenceAccess(ctx, 'growth', 'intelligenceOptimization');
    const input = campaignSchema.parse(await req.json());
    if (!(await adminDb.doc(`workspaces/${ctx.workspaceId}/products/${input.productId}`).get()).exists) throw new Error('NOT_FOUND');
    const id = randomUUID(); const now = new Date().toISOString();
    const campaign = { id, workspaceId: ctx.workspaceId, ...input, createdBy: ctx.uid, createdAt: now, updatedAt: now };
    await adminDb.doc(`workspaces/${ctx.workspaceId}/campaigns/${id}`).create(campaign);
    return apiCreated({ campaign });
  } catch (error) { return apiError(error); }
}
