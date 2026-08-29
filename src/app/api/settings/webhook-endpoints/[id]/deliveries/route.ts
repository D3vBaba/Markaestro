import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { listWebhookDeliveries } from '@/lib/public-api/webhooks';

export const runtime = 'nodejs';

/**
 * GET /api/settings/webhook-endpoints/[id]/deliveries
 *
 * Delivery attempts, response codes, and retry state for one endpoint.
 * Recorded since webhooks shipped and never exposed, which left a customer
 * whose receiver had been 500-ing for a week with no way to find out.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    const { id } = await params;
    const url = new URL(req.url);
    const page = await listWebhookDeliveries(ctx.workspaceId, id, {
      cursor: url.searchParams.get('cursor') || undefined,
      limit: Number(url.searchParams.get('limit')) || undefined,
    });
    return apiOk(page);
  } catch (error) {
    return apiError(error);
  }
}
