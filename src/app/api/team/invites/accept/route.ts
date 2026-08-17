import { requireContext } from '@/lib/server-auth';
import { apiOk, apiError } from '@/lib/api-response';
import { acceptPendingInvite } from '@/lib/team-invites';
import { isValidWorkspaceId } from '@/lib/workspace';
import { z } from 'zod';

export const runtime = 'nodejs';

const acceptSchema = z.object({ workspaceId: z.string().trim().min(1) });

/**
 * POST /api/team/invites/accept — join a workspace the user was invited to.
 *
 * Invites are matched purely on email, so the email claim must be verified
 * before it can redeem one — otherwise a sign-in method that yields
 * unverified emails could hijack another person's invite.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    if (!ctx.email) throw new Error('NOT_FOUND');
    if (!ctx.emailVerified) throw new Error('EMAIL_VERIFICATION_REQUIRED');

    const { workspaceId } = acceptSchema.parse(await req.json());
    if (!isValidWorkspaceId(workspaceId)) {
      throw new Error('VALIDATION_INVALID_WORKSPACE_ID');
    }

    const joined = await acceptPendingInvite({
      uid: ctx.uid,
      email: ctx.email,
      workspaceId,
      acceptLanguage: req.headers.get('accept-language'),
    });

    return apiOk({ joined });
  } catch (error) {
    return apiError(error);
  }
}
