import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { disableWebhookEndpoint } from '@/lib/public-api/webhooks';

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
