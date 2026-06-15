import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { setApiClientArchivedSchema } from '@/lib/public-api/schemas';

export const runtime = 'nodejs';

/**
 * POST /api/settings/api-clients/:id/archive — archive or unarchive a key.
 * Body: { archived: boolean }
 *
 * Archiving only applies to already-revoked keys: it hides them from the
 * default list without deleting the audit record. Active keys must be revoked
 * first. Unarchiving (archived: false) returns the key to the revoked list.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    const { id } = await params;
    const body = await req.json();
    const { archived } = setApiClientArchivedSchema.parse(body);

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/api_clients/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const current = snap.data() as { status?: 'active' | 'revoked' };
    if (archived && current.status !== 'revoked') {
      return apiOk(
        { error: 'ONLY_REVOKED_CAN_BE_ARCHIVED', message: 'Revoke the API key before archiving it.' },
        409,
      );
    }

    await ref.set({
      archived,
      archivedAt: archived ? new Date().toISOString() : null,
    }, { merge: true });

    return apiOk({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
