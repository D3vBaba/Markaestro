import { requireContext } from '@/lib/server-auth';
import { requireOwner } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiOk, apiError } from '@/lib/api-response';

export const runtime = 'nodejs';

/**
 * POST /api/team/[uid]/transfer-ownership — make an existing member the
 * workspace owner; the current owner becomes an admin.
 *
 * Both role writes happen in one transaction so the workspace can never be
 * observed with zero or two owners.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  try {
    const ctx = await requireContext(req);
    requireOwner(ctx);
    const { uid } = await params;

    if (uid === ctx.uid) return apiError(new Error('VALIDATION_ALREADY_OWNER'));

    const targetRef = adminDb.doc(`workspaces/${ctx.workspaceId}/members/${uid}`);
    const selfRef = adminDb.doc(`workspaces/${ctx.workspaceId}/members/${ctx.uid}`);

    await adminDb.runTransaction(async (tx) => {
      const [targetSnap, selfSnap] = await Promise.all([tx.get(targetRef), tx.get(selfRef)]);
      if (!targetSnap.exists) throw new Error('NOT_FOUND');
      // Re-check under the transaction: the caller must still be the owner.
      if (selfSnap.data()?.role !== 'owner') throw new Error('FORBIDDEN');

      tx.update(targetRef, { role: 'owner' });
      tx.update(selfRef, { role: 'admin' });
    });

    return apiOk({ newOwner: uid, previousOwner: ctx.uid });
  } catch (error) {
    return apiError(error);
  }
}
