import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { createWebhookEndpoint, listWebhookEndpoints } from '@/lib/public-api/webhooks';
import { registerWebhookEndpointSchema } from '@/lib/public-api/schemas';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    const webhookEndpoints = await listWebhookEndpoints(ctx.workspaceId);
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
