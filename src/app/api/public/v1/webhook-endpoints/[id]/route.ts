import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { disableWebhookEndpoint, updateWebhookEndpoint } from '@/lib/public-api/webhooks';
import { updateWebhookEndpointSchema } from '@/lib/public-api/schemas';

export const runtime = 'nodejs';


const WEBHOOK_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

/**
 * Partial update. A URL change re-runs the SSRF guard; the signing secret is
 * left alone, so changing an event list no longer costs the client a secret
 * rotation it did not ask for.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'webhooks.manage',
      rateLimit: WEBHOOK_RATE_LIMIT,
    });
    const { id } = await params;
    const data = updateWebhookEndpointSchema.parse(await req.json());
    const webhookEndpoint = await updateWebhookEndpoint(ctx.workspaceId, id, data);
    return Response.json({ webhookEndpoint }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'webhooks.manage',
      rateLimit: WEBHOOK_RATE_LIMIT,
    });
    const { id } = await params;
    await disableWebhookEndpoint(ctx.workspaceId, id);
    return new Response(null, { status: 204, headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
