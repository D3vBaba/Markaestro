import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import type { SocialChannel } from '@/lib/schemas';
import type { PlatformConnection, ConnectionStatus } from './types';
import { getAllDocs } from '@/lib/firestore-pagination';
import { getSelectedLinkedInDestination, matchLinkedInDestination } from '@/lib/platform/linkedin-api';
import {
  isLinkedInConnectionProvider,
  LINKEDIN_CONNECTION_PROVIDERS,
  LINKEDIN_PUBLIC_PROVIDER,
} from '@/lib/platform/linkedin-providers';

/**
 * Firestore path for platform connections.
 * Per-product: workspaces/{wid}/products/{pid}/platformConnections/{provider}
 * Workspace-level: workspaces/{wid}/platformConnections/{provider}
 */
function connectionPath(workspaceId: string, provider: string, productId?: string): string {
  if (productId) {
    return `workspaces/${workspaceId}/products/${productId}/platformConnections/${provider}`;
  }
  return `workspaces/${workspaceId}/platformConnections/${provider}`;
}

/**
 * Get the Firestore document reference for a connection.
 */
export function getConnectionRef(workspaceId: string, provider: string, productId?: string) {
  return adminDb.doc(connectionPath(workspaceId, provider, productId));
}

/**
 * Get a platform connection by provider.
 */
export async function getConnection(
  workspaceId: string,
  provider: string,
  productId?: string,
): Promise<PlatformConnection | null> {
  const snap = await getConnectionRef(workspaceId, provider, productId).get();
  if (!snap.exists) return null;
  return snap.data() as PlatformConnection;
}

/**
 * Get a merged Meta connection: workspace-level user token + product-level page metadata.
 * Falls back to a legacy product-level connection if no workspace connection exists.
 */
export async function getMetaConnectionMerged(
  workspaceId: string,
  productId?: string,
): Promise<PlatformConnection | null> {
  // Meta is linked per product: the user token and the chosen Facebook Page live
  // together on the product's own connection. There is no shared workspace-level
  // Meta connection, so a Meta lookup without a productId resolves to nothing.
  if (!productId) return null;
  return getConnection(workspaceId, 'meta', productId);
}

function hasReadyMetaDestination(connection: PlatformConnection | null, channel: SocialChannel): connection is PlatformConnection {
  if (!connection || connection.status !== 'connected') return false;
  if (channel === 'facebook') return Boolean(connection.metadata.pageId);
  if (channel === 'instagram') return Boolean(connection.metadata.igAccountId);
  return false;
}

async function getSoleProductScopedMetaConnectionMerged(
  workspaceId: string,
  channel: SocialChannel,
): Promise<PlatformConnection | null> {
  const productDocs = await getAllDocs(`workspaces/${workspaceId}/products`);

  let found: PlatformConnection | null = null;

  for (const product of productDocs) {
    const conn = await getMetaConnectionMerged(workspaceId, product.id);
    if (!hasReadyMetaDestination(conn, channel)) continue;

    if (found) {
      return null;
    }

    found = conn;
  }

  return found;
}

/**
 * Find the connection that serves a given channel.
 * Checks product-level first, then falls back to workspace-level.
 */
export async function getConnectionForChannel(
  workspaceId: string,
  channel: SocialChannel,
  productId?: string,
  preferredProvider?: string,
): Promise<PlatformConnection | null> {
  const providers = channelToProviders(channel, preferredProvider);

  for (const provider of providers) {
    // Meta uses merged workspace + product connection
    if (provider === 'meta') {
      const conn = await getMetaConnectionMerged(workspaceId, productId);
      if (hasReadyMetaDestination(conn, channel)) return conn;

      if (!productId) {
        const soleConn = await getSoleProductScopedMetaConnectionMerged(workspaceId, channel);
        if (soleConn) return soleConn;
      }
      continue;
    }
    // Product-level takes priority
    if (productId) {
      const conn = await getConnection(workspaceId, provider, productId);
      if (conn && conn.status === 'connected') return conn;
    }
    // Fall back to workspace-level
    const conn = await getConnection(workspaceId, provider);
    if (conn && conn.status === 'connected') return conn;

    // TikTok/TikTok Ads are product-scoped. If no productId was provided and
    // there is exactly one connected product-level integration in the workspace,
    // use it as a safe fallback.
    if (!productId) {
      const soleConn = await getSoleProductScopedConnection(workspaceId, provider);
      if (soleConn) return soleConn;
    }
  }

  return null;
}

function prioritizeProviders(providers: string[], preferredProvider?: string): string[] {
  if (!preferredProvider || !providers.includes(preferredProvider)) return providers;
  return [preferredProvider, ...providers.filter((provider) => provider !== preferredProvider)];
}

async function getCandidateConnection(
  workspaceId: string,
  provider: string,
  productId?: string,
): Promise<PlatformConnection | null> {
  if (productId) {
    const productConn = await getConnection(workspaceId, provider, productId);
    if (productConn?.status === 'connected') return productConn;
  }

  const workspaceConn = await getConnection(workspaceId, provider);
  if (workspaceConn?.status === 'connected') return workspaceConn;

  if (!productId) {
    return getSoleProductScopedConnection(workspaceId, provider);
  }

  return null;
}

export async function getLinkedInConnectionForDestination(
  workspaceId: string,
  productId?: string,
  destinationId?: string,
  preferredProvider?: string,
): Promise<PlatformConnection | null> {
  const providers = prioritizeProviders(
    [...LINKEDIN_CONNECTION_PROVIDERS],
    preferredProvider && isLinkedInConnectionProvider(preferredProvider)
      ? preferredProvider
      : undefined,
  );

  const candidates = (await Promise.all(
    providers.map((provider) => getCandidateConnection(workspaceId, provider, productId)),
  )).filter((conn): conn is PlatformConnection => Boolean(conn));

  if (destinationId) {
    return candidates.find((conn) => Boolean(matchLinkedInDestination(conn, destinationId))) || null;
  }

  const selected = candidates.find((conn) =>
    typeof conn.metadata.linkedinDestinationUrn === 'string' &&
    Boolean(getSelectedLinkedInDestination(conn))
  );
  if (selected) return selected;

  return candidates.find((conn) => conn.provider !== LINKEDIN_PUBLIC_PROVIDER) || candidates[0] || null;
}

async function getSoleProductScopedConnection(
  workspaceId: string,
  provider: string,
): Promise<PlatformConnection | null> {
  const productDocs = await getAllDocs(`workspaces/${workspaceId}/products`);

  let found: PlatformConnection | null = null;

  for (const product of productDocs) {
    const conn = await getConnection(workspaceId, provider, product.id);
    if (!conn || conn.status !== 'connected') continue;

    if (found) {
      return null;
    }
    found = conn;
  }

  return found;
}

/**
 * Resolve the best access token from a connection.
 * For Meta: prefers page access token over user access token.
 * For all others: returns the main access token.
 */
export function resolveAccessToken(connection: PlatformConnection): string {
  const pageToken = connection.metadata.pageAccessTokenEncrypted as string | undefined;
  if (pageToken) {
    return decrypt(pageToken);
  }
  return decrypt(connection.accessTokenEncrypted);
}

/**
 * Resolve the primary user access token.
 * Meta account and ads APIs require the user token, not the page token.
 */
export function resolveUserAccessToken(connection: PlatformConnection): string {
  return decrypt(connection.accessTokenEncrypted);
}

/**
 * Save or update a platform connection.
 */
export async function saveConnection(
  workspaceId: string,
  provider: string,
  data: Partial<PlatformConnection>,
  productId?: string,
): Promise<void> {
  const ref = getConnectionRef(workspaceId, provider, productId);
  await ref.set(
    { ...data, workspaceId, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

/**
 * Update connection status.
 */
export async function updateConnectionStatus(
  workspaceId: string,
  provider: string,
  status: ConnectionStatus,
  productId?: string,
): Promise<void> {
  await getConnectionRef(workspaceId, provider, productId).update({
    status,
    updatedAt: new Date().toISOString(),
  });
}

export async function markConnectionAuthError(
  workspaceId: string,
  provider: string,
  error: string,
  productId?: string,
): Promise<void> {
  await getConnectionRef(workspaceId, provider, productId).update({
    status: 'revoked',
    'metadata.lastRefreshError': error,
    'metadata.refreshFailureCount': 1,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Delete a platform connection.
 */
export async function deleteConnection(
  workspaceId: string,
  provider: string,
  productId?: string,
): Promise<void> {
  await getConnectionRef(workspaceId, provider, productId).delete();
}

/**
 * List all connections for a workspace (optionally scoped to a product).
 */
export async function listConnections(
  workspaceId: string,
  productId?: string,
): Promise<PlatformConnection[]> {
  const basePath = productId
    ? `workspaces/${workspaceId}/products/${productId}/platformConnections`
    : `workspaces/${workspaceId}/platformConnections`;

  const snap = await adminDb.collection(basePath).get();
  return snap.docs.map((doc) => doc.data() as PlatformConnection);
}

/**
 * Map a social channel to the providers that can serve it.
 */
function channelToProviders(channel: SocialChannel, preferredProvider?: string): string[] {
  const prioritize = (providers: string[]) =>
    preferredProvider && providers.includes(preferredProvider)
      ? [preferredProvider, ...providers.filter((provider) => provider !== preferredProvider)]
      : providers;

  switch (channel) {
    case 'facebook':
      return prioritize(['meta']);
    case 'instagram':
      // Prefer the standalone Instagram Login connection (the user's own token),
      // but fall back to the Facebook Page's linked Instagram Business account.
      // The Page path publishes via the long-lived (effectively non-expiring)
      // Page token, so company Instagram keeps working even if the standalone
      // 60-day token lapses — the durable default. getConnectionForChannel only
      // resolves meta here when the chosen Page actually has a linked IG
      // (hasReadyMetaDestination checks metadata.igAccountId).
      return prioritize(['instagram', 'meta']);
    case 'tiktok':
      return prioritize(['tiktok']);
    case 'threads':
      return prioritize(['threads']);
    case 'pinterest':
      return prioritize(['pinterest']);
    case 'linkedin':
      return prioritize(['linkedin_profile', 'linkedin_community', 'linkedin']);
  }
}
