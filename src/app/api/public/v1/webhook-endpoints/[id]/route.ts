import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { disableWebhookEndpoint } from '@/lib/public-api/webhooks';

const WEBHOOK_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

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
