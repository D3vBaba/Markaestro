import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { getConnection, getConnectionRef } from '@/lib/platform/connections';
import { getAdapter } from '@/lib/platform/registry';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json().catch(() => ({}));
    const productId = body.productId as string | undefined;

    if (!productId) {
      return apiOk({ ok: false, error: 'productId is required' });
    }

    const conn = await getConnection(ctx.workspaceId, 'x', productId);
    if (!conn) {
      return apiOk({ ok: false, error: 'X integration not configured' });
    }

    const adapter = getAdapter('x-publishing');
    if (!adapter) {
      return apiOk({ ok: false, error: 'X adapter not found' });
    }

    const result = await adapter.testConnection(conn);

    // If test returned a username and we didn't have one stored, save it
    if (result.ok && result.label && !conn.metadata.username) {
      const connRef = getConnectionRef(ctx.workspaceId, 'x', productId);
      await connRef.update({
        'metadata.username': result.label,
        updatedAt: new Date().toISOString(),
      });
    }

    return apiOk({ ok: result.ok, username: result.label, error: result.error });
  } catch (error) {
    return apiError(error);
  }
}
