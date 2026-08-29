import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { rotateWebhookEndpointSecret } from '@/lib/public-api/webhooks';

export const runtime = 'nodejs';

/**
 * Mint a new signing secret. Returned once, in this response, and never
 * retrievable again — mirroring `api-clients/[id]/rotate`.
 *
 * The previous secret keeps signing alongside the new one for a grace window
 * so deliveries do not fail while the customer redeploys their receiver;
 * `previousSecretExpiresAt` says when that stops.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    // Rotation mints a brand-new credential, so it carries the same
    // verified-email requirement as creating one.
    if (!ctx.emailVerified) {
      return apiOk(
        { error: 'EMAIL_NOT_VERIFIED', message: 'Verify your email to rotate webhook secrets.' },
        403,
      );
    }
    const { id } = await params;
    const webhookEndpoint = await rotateWebhookEndpointSecret(ctx.workspaceId, id);
    return apiOk({ webhookEndpoint });
  } catch (error) {
    return apiError(error);
  }
}
