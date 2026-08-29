import { apiOk } from '@/lib/api-response';
import { defineRoute } from '@/lib/api-route';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { sendWebhookTestEvent } from '@/lib/public-api/webhook-test-event';

export const runtime = 'nodejs';

/**
 * Queue one signed delivery to this endpoint, so an integrator can confirm
 * their verification works without waiting for a post to publish.
 *
 * Workspace-keyed limiter: it causes an outbound request to a URL the caller
 * chose, so it is a small outbound amplifier if left open.
 */
export const POST = defineRoute<{ id: string }>({
  role: 'admin',
  rateLimit: RATE_LIMITS.api,
  rateLimitKey: (ctx) => `webhook-test:${ctx.workspaceId}`,
}, async (_req, ctx, { params }) => {
  const { id } = await params;
  const result = await sendWebhookTestEvent(ctx.workspaceId, id);
  return apiOk({ ok: true, ...result });
});
