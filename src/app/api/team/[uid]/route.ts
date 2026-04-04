import { requireContext } from '@/lib/server-auth';
import { requirePermission, requireOwner } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiOk, apiError } from '@/lib/api-response';
import { z } from 'zod';

const updateSchema = z.object({
  role: z.enum(['admin', 'member', 'analyst']),
});

/** PATCH /api/team/[uid] — change a member's role (owner only) */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'team.roles.manage');
    const { uid } = await params;

    if (uid === ctx.uid) return apiError(new Error('FORBIDDEN'));

    const body = await req.json();
    const { role } = updateSchema.parse(body);

    const memberRef = adminDb.doc(`workspaces/${ctx.workspaceId}/members/${uid}`);
    const snap = await memberRef.get();
    if (!snap.exists) return apiError(new Error('NOT_FOUND'));
    if (snap.data()?.role === 'owner') return apiError(new Error('FORBIDDEN'));

    await memberRef.update({ role });
    return apiOk({ uid, role });
  } catch (error) {
    return apiError(error);
  }
}

/** DELETE /api/team/[uid] — remove a member (admin+ can remove members; owner can remove anyone) */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'team.manage');
    const { uid } = await params;

    if (uid === ctx.uid) return apiError(new Error('FORBIDDEN'));

    const memberRef = adminDb.doc(`workspaces/${ctx.workspaceId}/members/${uid}`);
    const snap = await memberRef.get();
    if (!snap.exists) return apiError(new Error('NOT_FOUND'));

    // Only owner can remove admins
    if (snap.data()?.role === 'admin') requireOwner(ctx);
    if (snap.data()?.role === 'owner') return apiError(new Error('FORBIDDEN'));

    await memberRef.delete();
    return apiOk({ removed: uid });
  } catch (error) {
    return apiError(error);
  }
}
