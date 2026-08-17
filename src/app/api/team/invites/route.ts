import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiOk, apiError } from '@/lib/api-response';
import { listPendingInvitesForEmail, deletePendingInvite } from '@/lib/team-invites';
import { z } from 'zod';

export const runtime = 'nodejs';

/**
 * GET /api/team/invites — list invites addressed to the signed-in user's
 * email, across all workspaces. This is what the in-app "you've been
 * invited" banner renders.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    if (!ctx.email || !ctx.emailVerified) {
      return apiOk({ invites: [] });
    }
    const invites = await listPendingInvitesForEmail(ctx.email);
    return apiOk({ invites });
  } catch (error) {
    return apiError(error);
  }
}

const revokeSchema = z.object({ email: z.string().trim().email() });

/**
 * DELETE /api/team/invites?email=… — revoke a pending invite in the current
 * workspace (admin+, same permission that created it).
 */
export async function DELETE(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'team.manage');

    const url = new URL(req.url);
    const { email } = revokeSchema.parse({ email: url.searchParams.get('email') ?? '' });

    await deletePendingInvite(ctx.workspaceId, email);
    return apiOk({ revoked: email.trim().toLowerCase() });
  } catch (error) {
    return apiError(error);
  }
}
