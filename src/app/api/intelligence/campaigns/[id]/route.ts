import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { campaignSchema } from '@/lib/intelligence/management-schemas';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req); requirePermission(ctx, 'intelligence.manage'); await requireIntelligenceAccess(ctx, 'growth', 'intelligenceOptimization');
    const { id } = await params; const input = campaignSchema.parse(await req.json());
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/campaigns/${id}`);
    if (!(await ref.get()).exists) throw new Error('NOT_FOUND');
    await ref.set({ ...input, updatedAt: new Date().toISOString(), updatedBy: ctx.uid }, { merge: true });
    return apiOk({ id, campaign: input });
  } catch (error) { return apiError(error); }
}
