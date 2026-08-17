import { requireContext } from '@/lib/server-auth';
import { apiOk, apiError } from '@/lib/api-response';
import { removeMemberWithCleanup } from '@/lib/team-members';

export const runtime = 'nodejs';

/**
 * POST /api/team/leave — leave the current workspace.
 *
 * Any non-owner member may remove themselves. Owners cannot leave: a
 * workspace must never be left ownerless, so an owner first transfers
 * ownership (POST /api/team/[uid]/transfer-ownership) or deletes the
 * workspace (DELETE /api/workspaces/[id]).
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);

    if (ctx.role === 'owner') {
      return apiError(new Error('VALIDATION_OWNER_CANNOT_LEAVE'));
    }

    const { revokedApiClients } = await removeMemberWithCleanup(ctx.workspaceId, ctx.uid, 'member_left');
    return apiOk({ left: ctx.workspaceId, revokedApiClients });
  } catch (error) {
    return apiError(error);
  }
}
