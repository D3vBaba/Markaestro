import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { createWebhookEndpoint, listWebhookEndpoints } from '@/lib/public-api/webhooks';
import { registerWebhookEndpointSchema } from '@/lib/public-api/schemas';
import {
  createRequestHash,
  getIdempotencyKey,
  loadIdempotentResponse,
  persistIdempotentResponse,
} from '@/lib/public-api/idempotency';

export const runtime = 'nodejs';


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
    const raw = await req.text();
    const data = registerWebhookEndpointSchema.parse(raw ? JSON.parse(raw) : {});

    // A retried create used to mint a second endpoint with a second secret,
    // and each workspace caps at 25 endpoints, so a flaky network could fill
    // the quota with duplicates. The replay carries the original secret,
    // which is only ever returned once per logical create.
    const idempotencyKey = getIdempotencyKey(req);
    const requestHash = idempotencyKey ? createRequestHash(raw) : null;
    if (idempotencyKey && requestHash) {
      const replay = await loadIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash);
      if (replay) {
        Object.entries(ctx.rateLimitHeaders).forEach(([key, value]) => replay.headers.set(key, value));
        return replay;
      }
    }

    const endpoint = await createWebhookEndpoint(ctx, data);
    const responseBody = { webhookEndpoint: endpoint };
    if (idempotencyKey && requestHash) {
      await persistIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash, 201, responseBody);
    }
    return Response.json(responseBody, { status: 201, headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
