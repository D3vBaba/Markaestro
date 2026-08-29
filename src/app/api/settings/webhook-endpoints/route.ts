import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import {
  createWebhookEndpoint,
  listWebhookEndpoints,
  summarizeWebhookEndpointHealth,
} from '@/lib/public-api/webhooks';
import { registerWebhookEndpointSchema } from '@/lib/public-api/schemas';

export const runtime = 'nodejs';


export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    const endpoints = await listWebhookEndpoints(ctx.workspaceId);
    // Rolling 24-hour health on the row itself, so a red endpoint is visible
    // in the list without opening it. This is the whole point of the item: a
    // receiver that has been 500-ing for a week should not look identical to
    // one that is fine.
    const health = await summarizeWebhookEndpointHealth(
      ctx.workspaceId,
      endpoints.map((endpoint) => endpoint.id),
    );
    const webhookEndpoints = endpoints.map((endpoint) => ({
      ...endpoint,
      health: health[endpoint.id] ?? null,
    }));
    return apiOk({ webhookEndpoints });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    const body = await req.json();
    const data = registerWebhookEndpointSchema.parse(body);
    const webhookEndpoint = await createWebhookEndpoint({
      workspaceId: ctx.workspaceId,
      principalType: 'user',
      clientId: ctx.uid,
    }, data);
    return apiOk({ webhookEndpoint }, 201);
  } catch (error) {
    return apiError(error);
  }
}
