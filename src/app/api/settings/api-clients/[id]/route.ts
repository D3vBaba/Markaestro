import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { updateApiClientScopesSchema } from '@/lib/public-api/schemas';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    const { id } = await params;
    const body = await req.json();
    const data = updateApiClientScopesSchema.parse(body);
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/api_clients/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const current = snap.data() as {
      name?: string;
      status?: 'active' | 'revoked';
      keyPrefix?: string;
      createdAt?: string;
      lastUsedAt?: string | null;
    };

    await ref.set({
      scopes: data.scopes,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
    }, { merge: true });

    return apiOk({
      apiClient: {
        id,
        name: current.name || '',
        scopes: data.scopes,
        status: current.status || 'revoked',
        keyPrefix: current.keyPrefix || '',
        createdAt: current.createdAt || new Date().toISOString(),
        lastUsedAt: current.lastUsedAt || null,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

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
