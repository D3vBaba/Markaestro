import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { listConnections } from '@/lib/platform/connections';
import type { PlatformConnection } from '@/lib/platform/types';

export const runtime = 'nodejs';


function maskConnection(
  conn: PlatformConnection,
  scope: 'workspace' | 'product',
) {
  return {
    provider: conn.provider,
    scope,
    productId: conn.productId ?? null,
    enabled: conn.status === 'connected',
    status: conn.status,
    hasAccessToken: Boolean(conn.accessTokenEncrypted),
    hasApiKey: Boolean(conn.metadata.apiKeyEncrypted),
    fromEmail: conn.metadata.fromEmail,
    pageId: conn.metadata.pageId,
    igAccountId: conn.metadata.igAccountId,
    tokenExpiresAt: conn.tokenExpiresAt ?? null,
    pageName: conn.metadata.pageName ?? null,
    pageSelectionRequired: conn.metadata.pageSelectionRequired ?? false,
    openId: conn.metadata.openId ?? null,
    username: conn.metadata.username ?? null,
    lastRefreshError: conn.metadata.lastRefreshError ?? null,
    boardId: conn.metadata.boardId ?? null,
    boardName: conn.metadata.boardName ?? null,
    boardSelectionRequired: conn.metadata.boardSelectionRequired ?? false,
    channelId: conn.metadata.channelId ?? null,
    channelTitle: conn.metadata.channelTitle ?? null,
    channelSelectionRequired: conn.metadata.channelSelectionRequired ?? false,
  };
}

/** Max product ids accepted by the batched `?productIds=` form. */
const MAX_BATCH_PRODUCT_IDS = 50;

/**
 * Merge product-scoped connections with workspace-level fallbacks — the same
 * shape the single-product endpoint has always returned.
 */
function productIntegrations(
  wsConns: PlatformConnection[],
  prodConns: PlatformConnection[],
) {
  const productProviders = new Set(prodConns.map((conn) => conn.provider));
  return [
    ...prodConns.map((conn) => maskConnection(conn, 'product')),
    ...wsConns
      .filter((conn) => !productProviders.has(conn.provider))
      .map((conn) => {
        const masked = maskConnection(conn, 'workspace');
        // If workspace has Meta but product doesn't, flag that page selection is needed
        if (conn.provider === 'meta') {
          return { ...masked, needsPageSelection: true };
        }
        return masked;
      }),
  ];
}

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const productId = url.searchParams.get('productId');
    const productIdsParam = url.searchParams.get('productIds');

    const wsConns = await listConnections(ctx.workspaceId);

    // Batched form: ?productIds=a,b,c → statuses for every product at once.
    if (productIdsParam !== null) {
      const ids = [
        ...new Set(
          productIdsParam
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ];
      if (ids.length > MAX_BATCH_PRODUCT_IDS) {
        throw new Error('VALIDATION_TOO_MANY_PRODUCT_IDS');
      }
      const prodConnLists = await Promise.all(
        ids.map((id) => listConnections(ctx.workspaceId, id)),
      );
      const products: Record<
        string,
        ReturnType<typeof productIntegrations>
      > = {};
      ids.forEach((id, i) => {
        products[id] = productIntegrations(wsConns, prodConnLists[i]);
      });
      return apiOk({ workspaceId: ctx.workspaceId, products });
    }

    if (!productId) {
      return apiOk({
        workspaceId: ctx.workspaceId,
        integrations: wsConns.map((conn) => maskConnection(conn, 'workspace')),
      });
    }

    const prodConns = await listConnections(ctx.workspaceId, productId);
    return apiOk({
      workspaceId: ctx.workspaceId,
      integrations: productIntegrations(wsConns, prodConns),
    });
  } catch (error) {
    return apiError(error);
  }
}
