import { requireContext } from '@/lib/server-auth';
import { apiOk, apiError } from '@/lib/api-response';
import { deletePendingInvite } from '@/lib/team-invites';
import { isValidWorkspaceId } from '@/lib/workspace';
import { z } from 'zod';

export const runtime = 'nodejs';

const declineSchema = z.object({ workspaceId: z.string().trim().min(1) });

/**
 * POST /api/team/invites/decline — turn down an invitation. Deletes the
 * pending invite addressed to the signed-in user's email; the inviter's
 * seat count frees up immediately.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    if (!ctx.email) return apiOk({ declined: null });

    const { workspaceId } = declineSchema.parse(await req.json());
    if (!isValidWorkspaceId(workspaceId)) {
      throw new Error('VALIDATION_INVALID_WORKSPACE_ID');
    }

    await deletePendingInvite(workspaceId, ctx.email);
    return apiOk({ declined: workspaceId });
  } catch (error) {
    return apiError(error);
  }
}
