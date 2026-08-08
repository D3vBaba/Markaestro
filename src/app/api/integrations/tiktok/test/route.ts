import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { listProviderConnections } from '@/lib/platform/connections';
import { getAdapter } from '@/lib/platform/registry';

export const runtime = 'nodejs';


export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'integrations.manage');
    const body = await req.json().catch(() => ({}));
    const productId = body.productId as string | undefined;

    if (!productId) {
      return apiOk({ ok: false, error: 'productId is required' });
    }

    // A brand can link several TikTok accounts; test the one requested, or all
    // of them so a single broken account is identifiable.
    const destinationId = typeof body.destinationId === 'string' ? body.destinationId : undefined;
    const conns = (await listProviderConnections(ctx.workspaceId, 'tiktok', productId))
      .filter((conn) => !destinationId || conn.accountKey === destinationId);
    if (conns.length === 0) {
      return apiOk({ ok: false, error: 'TikTok integration not configured' });
    }

    const adapter = getAdapter('tiktok-publishing');
    if (!adapter) {
      return apiOk({ ok: false, error: 'TikTok adapter not found' });
    }

    const results = await Promise.all(conns.map(async (conn) => ({
      destinationId: conn.accountKey ?? null,
      ...(await adapter.testConnection(conn)),
    })));

    return apiOk({
      ...results[0],
      ok: results.every((result) => result.ok),
      accounts: results,
    });
  } catch (error) {
    return apiError(error);
  }
}
