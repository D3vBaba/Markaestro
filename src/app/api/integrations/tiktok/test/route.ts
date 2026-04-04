import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { getConnection } from '@/lib/platform/connections';
import { getAdapter } from '@/lib/platform/registry';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'integrations.manage');
    const body = await req.json().catch(() => ({}));
    const productId = body.productId as string | undefined;

    if (!productId) {
      return apiOk({ ok: false, error: 'productId is required' });
    }

    const conn = await getConnection(ctx.workspaceId, 'tiktok', productId);
    if (!conn) {
      return apiOk({ ok: false, error: 'TikTok integration not configured' });
    }

    const adapter = getAdapter('tiktok-publishing');
    if (!adapter) {
      return apiOk({ ok: false, error: 'TikTok adapter not found' });
    }

    const result = await adapter.testConnection(conn);
    return apiOk(result);
  } catch (error) {
    return apiError(error);
  }
}
