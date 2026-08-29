import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { disableWebhookEndpoint, updateWebhookEndpoint } from '@/lib/public-api/webhooks';
import { updateWebhookEndpointSchema } from '@/lib/public-api/schemas';

export const runtime = 'nodejs';

/**
 * Edit a webhook endpoint in place.
 *
 * Without this, changing a URL meant delete-and-recreate, which minted a new
 * signing secret and broke the customer's receiver as a side effect of an
 * edit. `status: 'active'` is also the re-enable path for an endpoint that was
 * soft deleted.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    const { id } = await params;
    const data = updateWebhookEndpointSchema.parse(await req.json());
    const webhookEndpoint = await updateWebhookEndpoint(ctx.workspaceId, id, data);
    return apiOk({ webhookEndpoint });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    const { id } = await params;
    await disableWebhookEndpoint(ctx.workspaceId, id);
    return apiOk({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
