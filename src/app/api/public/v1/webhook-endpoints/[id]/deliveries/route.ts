import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { listWebhookDeliveries } from '@/lib/public-api/webhooks';

export const runtime = 'nodejs';

const WEBHOOK_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

/**
 * GET /api/public/v1/webhook-endpoints/[id]/deliveries
 *
 * The integrator-facing half of the same view. Read-only, so it takes
 * `webhooks.manage` for parity with the rest of the webhook surface rather
 * than inventing a read scope for one route.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'webhooks.manage',
      rateLimit: WEBHOOK_RATE_LIMIT,
    });
    const { id } = await params;
    const url = new URL(req.url);
    const page = await listWebhookDeliveries(ctx.workspaceId, id, {
      cursor: url.searchParams.get('cursor') || undefined,
      limit: Number(url.searchParams.get('limit')) || undefined,
    });
    return Response.json(
      { data: page.deliveries, nextCursor: page.nextCursor },
      { headers: ctx.rateLimitHeaders },
    );
  } catch (error) {
    return publicApiError(error);
  }
}
