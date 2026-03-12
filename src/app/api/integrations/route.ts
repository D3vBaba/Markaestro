import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { listConnections } from '@/lib/platform/connections';
import type { PlatformConnection } from '@/lib/platform/types';

function maskConnection(conn: PlatformConnection) {
  return {
    provider: conn.provider,
    enabled: conn.status === 'connected',
    status: conn.status,
    hasAccessToken: Boolean(conn.accessTokenEncrypted),
    hasApiKey: Boolean(conn.metadata.apiKeyEncrypted),
    fromEmail: conn.metadata.fromEmail,
    adAccountId: conn.metadata.adAccountId,
    pageId: conn.metadata.pageId,
    igAccountId: conn.metadata.igAccountId,
    tokenExpiresAt: conn.tokenExpiresAt ?? null,
    pageName: conn.metadata.pageName ?? null,
    openId: conn.metadata.openId ?? null,
    username: conn.metadata.username ?? null,
    lastRefreshError: conn.metadata.lastRefreshError ?? null,
  };
}

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const productId = url.searchParams.get('productId');

    const wsConns = await listConnections(ctx.workspaceId);
    const items = wsConns.map(maskConnection);

    if (productId) {
      const prodConns = await listConnections(ctx.workspaceId, productId);
      items.push(...prodConns.map(maskConnection));
    }

    return apiOk({ workspaceId: ctx.workspaceId, integrations: items });
  } catch (error) {
    return apiError(error);
  }
}
