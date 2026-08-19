import { requireContext } from '@/lib/server-auth';
import { requireOwner } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiOk, apiError } from '@/lib/api-response';
import { isValidWorkspaceId } from '@/lib/workspace';
import { purgeWorkspace } from '@/lib/workspace-delete';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 120;

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

/** PUT /api/workspaces/[id] — rename a workspace (owner only) */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;

    // Verify the user is owner of the target workspace
    const memberSnap = await adminDb
      .doc(`workspaces/${id}/members/${ctx.uid}`)
      .get();

    if (!memberSnap.exists) {
      throw new Error('NOT_FOUND');
    }

    const memberRole = memberSnap.data()?.role;
    requireOwner({ role: memberRole });

    const body = await req.json();
    const { name } = updateSchema.parse(body);

    await adminDb.doc(`workspaces/${id}`).update({ name });

    return apiOk({ id, name });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * DELETE /api/workspaces/[id] — permanently delete a workspace (owner only).
 *
 * Order matters: the Stripe subscription is canceled first so a failure
 * leaves the workspace intact and still billed (recoverable), never deleted
 * but still billing (invisible). Firestore cleanup then removes the
 * subscription record, the usage counter, and the whole workspace tree
 * (members, products, posts, connections, API clients, …).
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    if (!isValidWorkspaceId(id)) {
      throw new Error('VALIDATION_INVALID_WORKSPACE_ID');
    }

    // Verify the user is owner of the TARGET workspace (which may not be
    // the one the request context is scoped to).
    const memberSnap = await adminDb.doc(`workspaces/${id}/members/${ctx.uid}`).get();
    if (!memberSnap.exists) throw new Error('NOT_FOUND');
    requireOwner({ role: memberSnap.data()?.role });

    await purgeWorkspace(id);

    return apiOk({ deleted: id });
  } catch (error) {
    return apiError(error);
  }
}
