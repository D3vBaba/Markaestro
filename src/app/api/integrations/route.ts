import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { listConnections } from '@/lib/platform/connections';
import type { PlatformConnection } from '@/lib/platform/types';
import {
  isLinkedInConnectionProvider,
  LINKEDIN_COMMUNITY_PROVIDER,
  LINKEDIN_PROFILE_PROVIDER,
  LINKEDIN_PUBLIC_PROVIDER,
} from '@/lib/platform/linkedin-providers';

export const runtime = 'nodejs';


/**
 * One linked destination, as the UI renders it in a channel's account list.
 */
function maskAccount(conn: PlatformConnection, scope: 'workspace' | 'product') {
  return {
    connectionId: conn.connectionId ?? conn.provider,
    provider: conn.provider,
    scope,
    destinationId: conn.accountKey ?? null,
    label: conn.accountLabel ?? null,
    status: conn.status,
    enabled: conn.status === 'connected',
    productId: conn.productId ?? null,
    tokenExpiresAt: conn.tokenExpiresAt ?? null,
    lastRefreshError: conn.metadata.lastRefreshError ?? null,
    pageId: conn.metadata.pageId ?? null,
    pageName: conn.metadata.pageName ?? null,
    boardId: conn.metadata.boardId ?? null,
    boardName: conn.metadata.boardName ?? null,
    username: conn.metadata.username ?? null,
    igAccountId: conn.metadata.igAccountId ?? null,
    linkedinDestinationUrn: conn.metadata.linkedinDestinationUrn ?? null,
    linkedinDestinationName: conn.metadata.linkedinDestinationName ?? null,
    linkedinDestinationType: conn.metadata.linkedinDestinationType ?? null,
  };
}

function maskConnection(
  conn: PlatformConnection,
  scope: 'workspace' | 'product',
) {
  return {
    provider: conn.provider,
    connectionId: conn.connectionId ?? conn.provider,
    destinationId: conn.accountKey ?? null,
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
    linkedinProfileId: conn.metadata.linkedinProfileId ?? null,
    linkedinProfileName: conn.metadata.linkedinProfileName ?? null,
    linkedinPages: Array.isArray(conn.metadata.linkedinPages) ? conn.metadata.linkedinPages : [],
    linkedinDestinationUrn: conn.metadata.linkedinDestinationUrn ?? null,
    linkedinDestinationName: conn.metadata.linkedinDestinationName ?? null,
    linkedinDestinationType: conn.metadata.linkedinDestinationType ?? null,
    linkedinDestinationSelectionRequired: conn.metadata.linkedinDestinationSelectionRequired ?? false,
    linkedinPageDiscoveryError: conn.metadata.linkedinPageDiscoveryError ?? null,
    channelId: conn.metadata.channelId ?? null,
    channelTitle: conn.metadata.channelTitle ?? null,
    channelSelectionRequired: conn.metadata.channelSelectionRequired ?? false,
  };
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function firstBool(...values: unknown[]): boolean {
  return values.some((value) => value === true);
}

function findLinkedInConnection(conns: PlatformConnection[], provider: string) {
  return conns.find((conn) => conn.provider === provider);
}

function maskLinkedInConnectionBundle(
  conns: PlatformConnection[],
  scope: 'workspace' | 'product',
) {
  const profile = findLinkedInConnection(conns, LINKEDIN_PROFILE_PROVIDER);
  const community = findLinkedInConnection(conns, LINKEDIN_COMMUNITY_PROVIDER);
  const legacy = findLinkedInConnection(conns, LINKEDIN_PUBLIC_PROVIDER);
  const selected = [profile, community, legacy].find((conn) =>
    conn &&
    typeof conn.metadata.linkedinDestinationUrn === 'string' &&
    conn.metadata.linkedinDestinationUrn,
  );
  const statusSource = selected || conns.find((conn) => conn.status === 'connected') || conns[0];
  const profileMetadata = profile?.metadata || legacy?.metadata || {};
  const communityMetadata = community?.metadata || legacy?.metadata || {};
  const selectedMetadata = selected?.metadata || {};
  const hasSelectedDestination = typeof selectedMetadata.linkedinDestinationUrn === 'string' && !!selectedMetadata.linkedinDestinationUrn;

  return {
    provider: LINKEDIN_PUBLIC_PROVIDER,
    scope,
    productId: statusSource?.productId ?? null,
    enabled: conns.some((conn) => conn.status === 'connected'),
    status: statusSource?.status || 'revoked',
    hasAccessToken: conns.some((conn) => Boolean(conn.accessTokenEncrypted)),
    hasApiKey: false,
    tokenExpiresAt: statusSource?.tokenExpiresAt ?? null,
    username: firstString(profileMetadata.username, communityMetadata.username),
    lastRefreshError: firstString(profile?.metadata.lastRefreshError, community?.metadata.lastRefreshError, legacy?.metadata.lastRefreshError),
    linkedinProfileConnected: profile?.status === 'connected' || (!!legacy && legacy.status === 'connected' && !!legacy.metadata.linkedinProfileId),
    linkedinCommunityConnected: community?.status === 'connected' || (!!legacy && legacy.status === 'connected' && Array.isArray(legacy.metadata.linkedinPages) && legacy.metadata.linkedinPages.length > 0),
    linkedinProfileStatus: profile?.status ?? null,
    linkedinCommunityStatus: community?.status ?? null,
    linkedinProfileId: profileMetadata.linkedinProfileId ?? null,
    linkedinProfileName: profileMetadata.linkedinProfileName ?? null,
    linkedinPages: Array.isArray(communityMetadata.linkedinPages) ? communityMetadata.linkedinPages : [],
    linkedinDestinationUrn: selectedMetadata.linkedinDestinationUrn ?? null,
    linkedinDestinationName: selectedMetadata.linkedinDestinationName ?? null,
    linkedinDestinationType: selectedMetadata.linkedinDestinationType ?? null,
    linkedinDestinationSelectionRequired: !hasSelectedDestination && firstBool(profileMetadata.linkedinDestinationSelectionRequired, communityMetadata.linkedinDestinationSelectionRequired),
    linkedinPageDiscoveryError: communityMetadata.linkedinPageDiscoveryError ?? legacy?.metadata.linkedinPageDiscoveryError ?? null,
  };
}

/**
 * One entry per provider, carrying every destination linked for it. A brand
 * that has ten Facebook Pages linked returns a single `meta` entry whose
 * `accounts` array holds all ten — the channel tile lists them and each can be
 * unlinked on its own.
 */
function maskConnections(
  conns: PlatformConnection[],
  scope: 'workspace' | 'product',
) {
  const regular = conns.filter((conn) => !isLinkedInConnectionProvider(conn.provider));
  const linkedIn = conns.filter((conn) => isLinkedInConnectionProvider(conn.provider));

  const byProvider = new Map<string, PlatformConnection[]>();
  for (const conn of regular) {
    byProvider.set(conn.provider, [...(byProvider.get(conn.provider) || []), conn]);
  }

  const entries = [...byProvider.values()].map((group) => {
    // The healthiest destination represents the provider so one broken account
    // cannot make the whole channel read as disconnected.
    const primary = group.find((conn) => conn.status === 'connected') || group[0];
    return {
      ...maskConnection(primary, scope),
      accounts: group.map((conn) => maskAccount(conn, scope)),
    };
  });

  return [
    ...entries,
    ...(linkedIn.length > 0
      ? [{
        ...maskLinkedInConnectionBundle(linkedIn, scope),
        accounts: linkedIn
          .filter((conn) => conn.accountKey)
          .map((conn) => maskAccount(conn, scope)),
      }]
      : []),
  ];
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
  const visibleProdConns = maskConnections(prodConns, 'product');
  const visibleWsConns = maskConnections(wsConns, 'workspace');
  const productProviders = new Set(visibleProdConns.map((conn) => conn.provider));
  return [
    ...visibleProdConns,
    ...visibleWsConns
      .filter((conn) => !productProviders.has(conn.provider))
      .map((conn) => {
        // If workspace has Meta but product doesn't, flag that page selection is needed
        if (conn.provider === 'meta') {
          return { ...conn, needsPageSelection: true };
        }
        return conn;
      }),
  ];
}

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'dashboard.read');
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
        integrations: maskConnections(wsConns, 'workspace'),
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
