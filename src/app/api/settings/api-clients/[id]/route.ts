import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    const { id } = await params;
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/api_clients/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');
    await ref.set({
      status: 'revoked',
      revokedAt: new Date().toISOString(),
    }, { merge: true });
    return apiOk({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
