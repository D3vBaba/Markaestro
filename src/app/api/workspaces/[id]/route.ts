import { requireContext } from '@/lib/server-auth';
import { requireOwner } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiOk, apiError } from '@/lib/api-response';
import { z } from 'zod';

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
