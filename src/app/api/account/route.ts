import { requireContext } from '@/lib/server-auth';
import { apiOk, apiError } from '@/lib/api-response';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { confirmationMatchesEmail } from '@/lib/delete-helpers';
import { deleteAccount } from '@/lib/account-delete';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 120;

const deleteSchema = z.object({
  confirmation: z.string().trim().min(1).max(320),
});

/**
 * DELETE /api/account — permanently delete the signed-in user.
 *
 * Requires typing the account email. Owned workspaces are purged, team
 * memberships are removed, then the Auth user is deleted.
 */
export async function DELETE(req: Request) {
  try {
    const ctx = await requireContext(req);
    if (!ctx.email) throw new Error('NOT_FOUND');
    await applyRateLimit(req, RATE_LIMITS.auth, { key: `account-delete:${ctx.uid}` });

    const { confirmation } = deleteSchema.parse(await req.json());
    if (!confirmationMatchesEmail(confirmation, ctx.email)) {
      throw new Error('VALIDATION_CONFIRMATION_MISMATCH');
    }

    const result = await deleteAccount(ctx.uid, ctx.email);
    const resp = apiOk({ deleted: true, ...result });
    resp.headers.set(
      'Set-Cookie',
      '__session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    );
    return resp;
  } catch (error) {
    return apiError(error);
  }
}
