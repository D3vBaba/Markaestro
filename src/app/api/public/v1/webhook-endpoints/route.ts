import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { createWebhookEndpoint, listWebhookEndpoints } from '@/lib/public-api/webhooks';
import { registerWebhookEndpointSchema } from '@/lib/public-api/schemas';

const WEBHOOK_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export async function GET(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'webhooks.manage',
      rateLimit: WEBHOOK_RATE_LIMIT,
    });
    const endpoints = await listWebhookEndpoints(ctx.workspaceId);
    return Response.json({ webhookEndpoints: endpoints }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'webhooks.manage',
      rateLimit: WEBHOOK_RATE_LIMIT,
    });
    const body = await req.json();
    const data = registerWebhookEndpointSchema.parse(body);
    const endpoint = await createWebhookEndpoint(ctx, data);
    return Response.json({ webhookEndpoint: endpoint }, { status: 201, headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
