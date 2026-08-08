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
import {
  buildConnectionId,
  connectionAccountKey,
  connectionAccountLabel,
  connectionCredentialKey,
  connectionIdentityKey,
  connectionMatchesDestination,
  isAccountScopedConnectionId,
} from '@/lib/platform/connection-identity';

/**
 * Firestore path for the collection holding a scope's connections.
 * Per-product: workspaces/{wid}/products/{pid}/platformConnections
 * Workspace-level: workspaces/{wid}/platformConnections
 */
function connectionCollectionPath(workspaceId: string, productId?: string): string {
  return productId
    ? `workspaces/${workspaceId}/products/${productId}/platformConnections`
    : `workspaces/${workspaceId}/platformConnections`;
}

/**
 * Get the Firestore document reference for a connection.
 *
 * `accountKey` addresses one linked destination (Facebook Page, Pinterest
 * board, LinkedIn organization, …). Omitting it addresses the bare provider
 * document, which is the pending/credential record — not a publish target.
 */
export function getConnectionRef(
  workspaceId: string,
  provider: string,
  productId?: string,
  accountKey?: string | null,
) {
  return adminDb
    .collection(connectionCollectionPath(workspaceId, productId))
    .doc(buildConnectionId(provider, accountKey));
}

/** Get a document reference from an already-resolved connection id. */
export function getConnectionRefById(
  workspaceId: string,
  connectionId: string,
  productId?: string,
) {
  return adminDb.collection(connectionCollectionPath(workspaceId, productId)).doc(connectionId);
}

/** Reference to the document a stored connection came from. */
export function refForConnection(connection: PlatformConnection) {
  return getConnectionRefById(
    connection.workspaceId,
    connection.connectionId || buildConnectionId(connection.provider, connectionAccountKey(connection)),
    connection.productId,
  );
}

/**
 * Attach the derived identity fields so callers can treat legacy documents
 * (keyed by provider alone, with no persisted accountKey) exactly like
 * account-scoped ones.
 */
function hydrateConnection(
  doc: FirebaseFirestore.DocumentSnapshot,
  workspaceId: string,
  productId?: string,
): PlatformConnection {
  const data = doc.data() as PlatformConnection;
  const provider = data.provider || doc.id.split(':')[0];
  const base: PlatformConnection = {
    ...data,
    provider,
    workspaceId: data.workspaceId || workspaceId,
    ...(productId ? { productId } : {}),
    connectionId: doc.id,
  };
  return {
    ...base,
    accountKey: connectionAccountKey(base),
    accountLabel: connectionAccountLabel(base),
    credentialKey: connectionCredentialKey(base),
  };
}

/**
 * Every connection document in a scope, without collapsing legacy twins or
 * hiding pending grants. Use this when you need the raw records — token
 * refresh, credential enumeration — rather than the display-facing list.
 */
async function listConnectionDocs(
  workspaceId: string,
  productId?: string,
): Promise<PlatformConnection[]> {
  const snap = await adminDb.collection(connectionCollectionPath(workspaceId, productId)).get();
  return snap.docs.map((doc) => hydrateConnection(doc, workspaceId, productId));
}

export async function listAllConnectionDocs(
  workspaceId: string,
  productId?: string,
): Promise<PlatformConnection[]> {
  return listConnectionDocs(workspaceId, productId);
}

/**
 * One usable credential per authorizing account for a provider.
 *
 * Every linked destination carries a copy of the token that authorized it, so
 * an account stays enumerable through its destinations even after its pending
 * document has been replaced by a later login. Without this, connecting a
 * second Pinterest or LinkedIn account made the first one's remaining
 * boards/Pages impossible to reach.
 */
export async function listProviderCredentials(
  workspaceId: string,
  provider: string,
  productId?: string,
): Promise<PlatformConnection[]> {
  const docs = (await listConnectionDocs(workspaceId, productId))
    .filter((conn) => conn.provider === provider && Boolean(conn.accessTokenEncrypted));

  const byCredential = new Map<string, PlatformConnection>();
  for (const conn of docs) {
    const key = conn.credentialKey || conn.accountKey || conn.connectionId || provider;
    const existing = byCredential.get(key);
    // Prefer the pending grant document: it is the one a fresh login refreshes,
    // so it holds the newest token for this account.
    if (!existing || (!conn.accountKey && existing.accountKey)) {
      byCredential.set(key, conn);
    }
  }

  return [...byCredential.values()].sort(
    (a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''),
  );
}

/**
 * Collapse legacy and account-scoped records of the same destination, and drop
 * a superseded pending document (bare provider, no destination) once at least
 * one real destination exists for that provider.
 */
function dedupeConnections(connections: PlatformConnection[]): PlatformConnection[] {
  const providersWithDestination = new Set(
    connections.filter((conn) => conn.accountKey).map((conn) => conn.provider),
  );

  const byIdentity = new Map<string, PlatformConnection>();
  for (const conn of connections) {
    if (!conn.accountKey && providersWithDestination.has(conn.provider)) continue;

    const identity = connectionIdentityKey(conn);
    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, conn);
      continue;
    }

    // Prefer the account-scoped document over the legacy single-slot one.
    const incomingIsScoped = isAccountScopedConnectionId(conn.provider, conn.connectionId || '');
    const existingIsScoped = isAccountScopedConnectionId(existing.provider, existing.connectionId || '');
    if (incomingIsScoped && !existingIsScoped) {
      byIdentity.set(identity, conn);
    }
  }

  return [...byIdentity.values()].sort(
    (a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''),
  );
}

/**
 * Get a single connection document by provider (and optional destination).
 * Used for credential lookups; prefer `listProviderConnections` when you need
 * every destination a user has linked.
 */
export async function getConnection(
  workspaceId: string,
  provider: string,
  productId?: string,
  accountKey?: string | null,
): Promise<PlatformConnection | null> {
  const snap = await getConnectionRef(workspaceId, provider, productId, accountKey).get();
  if (!snap.exists) return null;
  return hydrateConnection(snap, workspaceId, productId);
}

/**
 * List all connections for a workspace (optionally scoped to a product).
 */
export async function listConnections(
  workspaceId: string,
  productId?: string,
): Promise<PlatformConnection[]> {
  return dedupeConnections(await listConnectionDocs(workspaceId, productId));
}

/**
 * Every connection for a provider within one scope, oldest first. A user who
 * manages ten Facebook Pages gets ten entries here.
 */
export async function listProviderConnections(
  workspaceId: string,
  provider: string,
  productId?: string,
): Promise<PlatformConnection[]> {
  const all = await listConnections(workspaceId, productId);
  return all.filter((conn) => conn.provider === provider);
}

/**
 * Every app-user credential a provider holds at workspace scope, oldest first.
 *
 * Meta authorizes an app-user once and that grant covers the Pages the user
 * ticked, so the user token lives here rather than on any single Page. A
 * workspace can hold more than one — connecting a second Facebook account adds
 * a credential, and each one owns only its own Pages.
 */
export async function listWorkspaceCredentials(
  workspaceId: string,
  provider: string,
): Promise<PlatformConnection[]> {
  const docs = (await listConnectionDocs(workspaceId))
    .filter((conn) => conn.provider === provider && Boolean(conn.accessTokenEncrypted));

  const byCredential = new Map<string, PlatformConnection>();
  for (const conn of docs) {
    const key = conn.credentialKey || conn.connectionId || provider;
    if (!byCredential.has(key)) byCredential.set(key, conn);
  }

  return [...byCredential.values()].sort(
    (a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''),
  );
}

/**
 * One workspace credential. Pass `credentialKey` to address a specific
 * account; without it this returns the oldest, which is the right answer only
 * when a single account is connected.
 */
export async function getWorkspaceCredential(
  workspaceId: string,
  provider: string,
  credentialKey?: string | null,
): Promise<PlatformConnection | null> {
  const credentials = await listWorkspaceCredentials(workspaceId, provider);
  if (credentialKey) {
    return credentials.find((conn) => conn.credentialKey === credentialKey) || null;
  }
  return credentials[0] || null;
}

/**
 * Overlay the workspace user token onto a Page connection. Publishing uses the
 * Page token (see resolveAccessToken); account and ads APIs need the user
 * token, and the workspace copy is the one being refreshed.
 *
 * The credential must be the one that authorized *this* Page. With two Facebook
 * accounts connected, overlaying an arbitrary credential would hand one
 * account's user token — and its metaUserId — to the other account's Pages.
 */
function mergeMetaCredential(
  connection: PlatformConnection,
  credentials: PlatformConnection[],
): PlatformConnection {
  const owner = connection.credentialKey
    ? credentials.find((cred) => cred.credentialKey === connection.credentialKey)
    // A Page linked before credentials were keyed can only be matched when a
    // single account exists; otherwise leave it on its own stored tokens.
    : credentials.length === 1
      ? credentials[0]
      : undefined;

  if (!owner) return connection;

  return {
    ...connection,
    accessTokenEncrypted: owner.accessTokenEncrypted || connection.accessTokenEncrypted,
    ...(owner.tokenExpiresAt ? { tokenExpiresAt: owner.tokenExpiresAt } : {}),
    metadata: {
      ...owner.metadata,
      ...connection.metadata,
    },
  };
}

/**
 * Get a merged Meta connection: workspace-level user token + product-level page
 * metadata. With no `accountKey` this returns the first linked Page so existing
 * single-Page callers keep working.
 */
export async function getMetaConnectionMerged(
  workspaceId: string,
  productId?: string,
  accountKey?: string | null,
): Promise<PlatformConnection | null> {
  const credentials = await listWorkspaceCredentials(workspaceId, 'meta');

  if (!productId) return credentials[0] || null;

  const productConnections = await listProviderConnections(workspaceId, 'meta', productId);
  const productConnection = accountKey
    ? productConnections.find((conn) => conn.accountKey === accountKey)
    : productConnections.find((conn) => Boolean(conn.metadata.pageId)) || productConnections[0];

  if (!productConnection) return credentials[0] || null;

  return mergeMetaCredential(productConnection, credentials);
}

function hasReadyMetaDestination(
  connection: PlatformConnection | null,
  channel: SocialChannel,
): connection is PlatformConnection {
  if (!connection || connection.status !== 'connected') return false;
  if (channel === 'facebook') return Boolean(connection.metadata.pageId);
  return false;
}

/**
 * Every connection that can serve a channel within a scope, in provider
 * priority order and oldest-first within a provider. Product-scoped
 * connections win outright; workspace-scoped ones are the fallback.
 */
export async function listChannelConnections(
  workspaceId: string,
  channel: SocialChannel,
  productId?: string,
  preferredProvider?: string,
): Promise<PlatformConnection[]> {
  const providers = channelToProviders(channel, preferredProvider);
  const [productConnections, workspaceConnections] = await Promise.all([
    productId ? listConnections(workspaceId, productId) : Promise.resolve([]),
    listConnections(workspaceId),
  ]);

  const metaCredentials = workspaceConnections.filter(
    (conn) => conn.provider === 'meta' && Boolean(conn.accessTokenEncrypted),
  );

  const forProvider = (source: PlatformConnection[], provider: string) =>
    source
      .filter((conn) => conn.provider === provider)
      .map((conn) => (provider === 'meta' ? mergeMetaCredential(conn, metaCredentials) : conn));

  const results: PlatformConnection[] = [];
  for (const provider of providers) {
    const scoped = forProvider(productConnections, provider);
    // A bare Meta credential is not a publish destination — it owns no Page.
    const usable = scoped.filter((conn) => provider !== 'meta' || Boolean(conn.metadata.pageId));
    if (usable.length > 0) {
      results.push(...usable);
      continue;
    }

    const workspaceScoped = forProvider(workspaceConnections, provider).filter(
      (conn) => provider !== 'meta' || Boolean(conn.metadata.pageId),
    );
    if (workspaceScoped.length > 0) {
      results.push(...workspaceScoped);
      continue;
    }

    // Product-scoped providers with no productId in hand: fall back to the
    // workspace's sole connected product integration, if it is unambiguous.
    if (!productId) {
      const sole = await getSoleProductScopedConnection(workspaceId, provider, channel);
      if (sole) results.push(sole);
    }
  }

  return results;
}

/**
 * Find the connection that serves a given channel. When several destinations
 * are linked, `destinationId` selects one; otherwise the oldest connected
 * destination is the stable default.
 */
export async function getConnectionForChannel(
  workspaceId: string,
  channel: SocialChannel,
  productId?: string,
  preferredProvider?: string,
  destinationId?: string,
): Promise<PlatformConnection | null> {
  if (channel === 'linkedin') {
    return getLinkedInConnectionForDestination(workspaceId, productId, destinationId, preferredProvider);
  }

  const candidates = await listChannelConnections(workspaceId, channel, productId, preferredProvider);

  if (destinationId) {
    const requested = candidates.find((conn) => connectionMatchesDestination(conn, destinationId));
    // An explicit destination must never silently publish somewhere else.
    if (!requested) return null;
    return requested.status === 'connected' ? requested : null;
  }

  return candidates.find((conn) => conn.status === 'connected') || null;
}

function prioritizeProviders(providers: string[], preferredProvider?: string): string[] {
  if (!preferredProvider || !providers.includes(preferredProvider)) return providers;
  return [preferredProvider, ...providers.filter((provider) => provider !== preferredProvider)];
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

  const [productConnections, workspaceConnections] = await Promise.all([
    productId ? listConnections(workspaceId, productId) : Promise.resolve([]),
    listConnections(workspaceId),
  ]);

  const candidates: PlatformConnection[] = [];
  for (const provider of providers) {
    const scoped = productConnections.filter((conn) => conn.provider === provider);
    if (scoped.length > 0) {
      candidates.push(...scoped);
      continue;
    }
    const workspaceScoped = workspaceConnections.filter((conn) => conn.provider === provider);
    if (workspaceScoped.length > 0) {
      candidates.push(...workspaceScoped);
      continue;
    }
    if (!productId) {
      const sole = await getSoleProductScopedConnection(workspaceId, provider, 'linkedin');
      if (sole) candidates.push(sole);
    }
  }

  const connected = candidates.filter((conn) => conn.status === 'connected');
  const pool = connected.length > 0 ? connected : candidates;

  if (destinationId) {
    // Each linked destination clones the credential's discovery metadata, so
    // every document can "see" every Page. Prefer the document that actually
    // owns this destination, then fall back to metadata matching for legacy
    // records that hold all destinations in one document.
    return (
      pool.find((conn) => connectionMatchesDestination(conn, destinationId)) ||
      pool.find((conn) => Boolean(matchLinkedInDestination(conn, destinationId))) ||
      null
    );
  }

  const selected = pool.find((conn) =>
    typeof conn.metadata.linkedinDestinationUrn === 'string' &&
    Boolean(getSelectedLinkedInDestination(conn))
  );
  if (selected) return selected;

  return pool.find((conn) => conn.provider !== LINKEDIN_PUBLIC_PROVIDER) || pool[0] || null;
}

/**
 * Some providers are only ever linked per product. When a caller has no
 * productId, use the workspace's single connected product integration — but
 * only when there is exactly one, so publishing never guesses between brands.
 */
async function getSoleProductScopedConnection(
  workspaceId: string,
  provider: string,
  channel?: SocialChannel,
): Promise<PlatformConnection | null> {
  const productDocs = await getAllDocs(`workspaces/${workspaceId}/products`);
  const credentials = provider === 'meta' ? await listWorkspaceCredentials(workspaceId, 'meta') : [];

  let found: PlatformConnection | null = null;

  for (const product of productDocs) {
    const conns = (await listProviderConnections(workspaceId, provider, product.id))
      .map((conn) => (provider === 'meta' ? mergeMetaCredential(conn, credentials) : conn))
      .filter((conn) => conn.status === 'connected')
      .filter((conn) => (provider === 'meta' && channel ? hasReadyMetaDestination(conn, channel) : true));

    if (conns.length === 0) continue;
    // More than one destination anywhere in the workspace is ambiguous.
    if (conns.length > 1 || found) return null;

    found = conns[0];
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
 * Save or update a platform connection. Pass `accountKey` to address one linked
 * destination; without it this writes the pending/credential document.
 */
export async function saveConnection(
  workspaceId: string,
  provider: string,
  data: Partial<PlatformConnection>,
  productId?: string,
  accountKey?: string | null,
): Promise<void> {
  const ref = getConnectionRef(workspaceId, provider, productId, accountKey);
  await ref.set(
    {
      ...data,
      workspaceId,
      connectionId: ref.id,
      ...(accountKey ? { accountKey } : {}),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

/**
 * Link one destination (Pinterest board, LinkedIn Page, …) as its own
 * connection, cloning the authorizing credential's tokens. Linking a second
 * destination therefore adds a connection rather than displacing the first.
 */
export async function linkDestinationConnection(input: {
  credential: PlatformConnection;
  workspaceId: string;
  productId: string;
  userId: string;
  provider: string;
  accountKey: string;
  accountLabel: string;
  metadata: Record<string, unknown>;
}): Promise<PlatformConnection> {
  const ref = getConnectionRef(input.workspaceId, input.provider, input.productId, input.accountKey);
  const existingSnap = await ref.get();
  const existing = existingSnap.exists ? (existingSnap.data() as Partial<PlatformConnection>) : null;
  const now = new Date().toISOString();

  const connection: PlatformConnection = {
    provider: input.provider,
    connectionId: ref.id,
    accountKey: input.accountKey,
    accountLabel: input.accountLabel,
    channels: input.credential.channels,
    capabilities: input.credential.capabilities,
    status: 'connected',
    accessTokenEncrypted: input.credential.accessTokenEncrypted,
    ...(input.credential.refreshTokenEncrypted
      ? { refreshTokenEncrypted: input.credential.refreshTokenEncrypted }
      : {}),
    ...(input.credential.tokenExpiresAt ? { tokenExpiresAt: input.credential.tokenExpiresAt } : {}),
    metadata: {
      ...input.credential.metadata,
      ...(existing?.metadata || {}),
      ...input.metadata,
      lastRefreshError: null,
      refreshFailureCount: 0,
    },
    workspaceId: input.workspaceId,
    productId: input.productId,
    updatedBy: input.userId,
    updatedAt: now,
    createdAt: existing?.createdAt || now,
  };

  await ref.set(connection, { merge: true });
  return connection;
}

/**
 * Update connection status.
 */
export async function updateConnectionStatus(
  workspaceId: string,
  provider: string,
  status: ConnectionStatus,
  productId?: string,
  accountKey?: string | null,
): Promise<void> {
  await getConnectionRef(workspaceId, provider, productId, accountKey).update({
    status,
    updatedAt: new Date().toISOString(),
  });
}

/** Set the status of the specific document a connection was loaded from. */
export async function setConnectionStatus(
  connection: PlatformConnection,
  status: ConnectionStatus,
): Promise<void> {
  await refForConnection(connection).update({
    status,
    updatedAt: new Date().toISOString(),
  });
}

/** Mark the specific connection document that failed authorization. */
export async function markConnectionAuthError(
  connection: PlatformConnection,
  error: string,
): Promise<void> {
  await refForConnection(connection).update({
    status: 'revoked',
    'metadata.lastRefreshError': error,
    'metadata.refreshFailureCount': 1,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Delete a platform connection. Without `accountKey` this removes every
 * destination linked for the provider in that scope.
 */
export async function deleteConnection(
  workspaceId: string,
  provider: string,
  productId?: string,
  accountKey?: string | null,
): Promise<void> {
  if (accountKey) {
    await getConnectionRef(workspaceId, provider, productId, accountKey).delete();
    return;
  }

  const snap = await adminDb.collection(connectionCollectionPath(workspaceId, productId)).get();
  const targets = snap.docs.filter((doc) => {
    const data = doc.data() as Partial<PlatformConnection>;
    return (data.provider || doc.id.split(':')[0]) === provider;
  });
  await Promise.all(targets.map((doc) => doc.ref.delete()));
}

/** Delete one connection document by its id. */
export async function deleteConnectionById(
  workspaceId: string,
  connectionId: string,
  productId?: string,
): Promise<void> {
  await getConnectionRefById(workspaceId, connectionId, productId).delete();
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
      // Instagram is served only by the standalone Instagram Login provider.
      // Facebook Page connections remain Facebook-only, even if legacy Meta
      // records still contain an igAccountId.
      return prioritize(['instagram']);
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
