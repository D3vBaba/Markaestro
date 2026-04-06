import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import type { SocialChannel } from '@/lib/schemas';
import type { PlatformConnection, ConnectionStatus } from './types';
import { getAllDocs } from '@/lib/firestore-pagination';

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
  const wsConn = await getConnection(workspaceId, 'meta');

  if (wsConn) {
    if (!productId) return wsConn;

    const prodConn = await getConnection(workspaceId, 'meta', productId);
    if (!prodConn) return wsConn;

    // Merge: workspace user token + product page metadata
    return {
      ...wsConn,
      productId,
      metadata: { ...wsConn.metadata, ...prodConn.metadata },
    };
  }

  // Backward compat: legacy product-level connection with its own user token
  if (productId) {
    const prodConn = await getConnection(workspaceId, 'meta', productId);
    if (prodConn?.accessTokenEncrypted) return prodConn;
  }

  return null;
}

/**
 * Find the connection that serves a given channel.
 * Checks product-level first, then falls back to workspace-level.
 */
export async function getConnectionForChannel(
  workspaceId: string,
  channel: SocialChannel,
  productId?: string,
): Promise<PlatformConnection | null> {
  const providers = channelToProviders(channel);

  for (const provider of providers) {
    // Meta uses merged workspace + product connection
    if (provider === 'meta') {
      const conn = await getMetaConnectionMerged(workspaceId, productId);
      if (conn && conn.status === 'connected') return conn;
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
function channelToProviders(channel: SocialChannel): string[] {
  switch (channel) {
    case 'facebook':
    case 'instagram':
      return ['meta'];
    case 'tiktok':
      return ['tiktok'];
  }
}
