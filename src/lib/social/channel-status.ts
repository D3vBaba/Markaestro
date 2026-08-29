import { adminDb } from '@/lib/firebase-admin';
import { getAdapterForChannel } from '@/lib/platform/registry';
import { listConnections } from '@/lib/platform/connections';
import type { PlatformAdapter, PlatformConnection } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import {
  connectionAccountKey,
  normalizeDestinationId,
} from '@/lib/platform/connection-identity';
import {
  getSocialChannelProviderKeys,
  socialChannelCatalog,
  type ManagedSocialChannel,
} from '@/lib/social/channel-catalog';

export type ManagedSocialChannelState = 'ready' | 'needs_setup' | 'disconnected';

/** One linked account/page/board a channel can publish to. */
export type ManagedSocialChannelDestination = {
  connectionId: string;
  provider: string;
  scope: 'workspace' | 'product';
  /** Value to send as a post's `destinationId`; null for legacy records. */
  destinationId: string | null;
  label: string | null;
  state: ManagedSocialChannelState;
  reason: string | null;
  lastRefreshError: string | null;
};

export type ManagedSocialChannelStatus = ManagedSocialChannel & {
  state: ManagedSocialChannelState;
  reason: string | null;
  provider: string | null;
  connectionScope: 'workspace' | 'product' | null;
  destinationLabel: string | null;
  /** Every account linked for this channel, oldest first. */
  destinations: ManagedSocialChannelDestination[];
  capabilities: string[];
  lastRefreshError?: string | null;
  /**
   * The long-lived token exchange failed at connect time and this connection
   * is running on a short-lived token (see EH-07). It works right now and dies
   * in about an hour instead of about sixty days, which is why it needs
   * surfacing before a publish discovers it.
   */
  tokenExchangeDegraded?: boolean;
};

type ScopedConnection = { connection: PlatformConnection; scope: 'workspace' | 'product' };

type ConnectionBundle = {
  workspace: PlatformConnection[];
  product: PlatformConnection[];
};

/**
 * Overlay the canonical workspace Meta credential onto a Page connection.
 * Readiness follows the Page document, which owns the selected Page and its
 * long-lived Page access token. Facebook publishing uses that Page token (see
 * resolveAccessToken), not the workspace user token — so a lapsed 60-day user
 * token must not blur out an otherwise-valid Page channel. The workspace
 * connection still supplies the user token for account/ads APIs.
 */
function mergeMetaConnection(
  workspaceConnection: PlatformConnection | undefined,
  productConnection: PlatformConnection,
  productId?: string,
): PlatformConnection {
  if (!workspaceConnection) return productConnection;
  return {
    // Identity (connectionId, accountKey) belongs to the Page document; the
    // user token and its expiry come from the canonical workspace credential.
    ...productConnection,
    accessTokenEncrypted:
      workspaceConnection.accessTokenEncrypted || productConnection.accessTokenEncrypted,
    ...(workspaceConnection.tokenExpiresAt
      ? { tokenExpiresAt: workspaceConnection.tokenExpiresAt }
      : {}),
    status: productConnection.status,
    productId,
    metadata: {
      ...workspaceConnection.metadata,
      ...productConnection.metadata,
    },
  };
}

/**
 * Every connection a provider offers in this scope. Product-scoped connections
 * take priority; workspace-scoped ones are the fallback.
 */
function findProviderConnections(
  bundle: ConnectionBundle,
  provider: string,
  productId?: string,
): ScopedConnection[] {
  const workspaceConnections = bundle.workspace.filter((conn) => conn.provider === provider);
  const productConnections = bundle.product.filter((conn) => conn.provider === provider);

  if (provider === 'meta') {
    const credential = workspaceConnections[0];
    const pageConnections = productConnections.filter((conn) => Boolean(conn.metadata.pageId));
    if (pageConnections.length > 0) {
      return pageConnections.map((conn) => ({
        connection: mergeMetaConnection(credential, conn, productId),
        scope: 'product' as const,
      }));
    }
    // Authorized but no Page picked yet — surface the pending connection so the
    // channel tile can prompt for a selection.
    const pending = productConnections[0] || credential;
    return pending
      ? [{ connection: pending, scope: productConnections[0] ? 'product' : 'workspace' }]
      : [];
  }

  if (productConnections.length > 0) {
    return productConnections.map((connection) => ({ connection, scope: 'product' as const }));
  }

  return workspaceConnections.map((connection) => ({ connection, scope: 'workspace' as const }));
}

function findConnectionsForChannel(
  bundle: ConnectionBundle,
  channel: SocialChannel,
  productId?: string,
): ScopedConnection[] {
  // A channel can be served by more than one provider (e.g. LinkedIn via
  // profile/community/public credentials); collect destinations from all of them.
  return getSocialChannelProviderKeys(channel).flatMap((provider) =>
    findProviderConnections(bundle, provider, productId),
  );
}

function getDestinationLabel(connection: PlatformConnection, channel: SocialChannel): string | null {
  const metadata = connection.metadata;

  if (channel === 'facebook') {
    return typeof metadata.pageName === 'string' && metadata.pageName ? metadata.pageName : null;
  }

  if (channel === 'instagram' || channel === 'threads' || channel === 'tiktok') {
    return typeof metadata.username === 'string' && metadata.username ? metadata.username : null;
  }

  if (channel === 'pinterest') {
    return typeof metadata.boardName === 'string' && metadata.boardName ? metadata.boardName : null;
  }

  if (channel === 'linkedin') {
    return typeof metadata.linkedinDestinationName === 'string' && metadata.linkedinDestinationName
      ? metadata.linkedinDestinationName
      : null;
  }

  return null;
}

function buildDestination(
  match: ScopedConnection,
  config: ManagedSocialChannel,
  adapter: PlatformAdapter,
): ManagedSocialChannelDestination {
  const { connection, scope } = match;
  const lastRefreshError = typeof connection.metadata.lastRefreshError === 'string'
    ? connection.metadata.lastRefreshError
    : null;

  const base = {
    connectionId: connection.connectionId || connection.provider,
    provider: connection.provider,
    scope,
    destinationId: connectionAccountKey(connection),
    label: getDestinationLabel(connection, config.channel),
    lastRefreshError,
  };

  if (connection.status !== 'connected') {
    return {
      ...base,
      state: 'disconnected',
      reason: lastRefreshError ||
        `${config.label} connection is ${connection.status}. Reconnect it in brand settings.`,
    };
  }

  const validationError = adapter.validateConnection(connection, config.channel);
  return {
    ...base,
    state: validationError ? 'needs_setup' : 'ready',
    reason: validationError,
  };
}

/** Rank so the healthiest destination represents the channel. */
const STATE_RANK: Record<ManagedSocialChannelState, number> = {
  ready: 0,
  needs_setup: 1,
  disconnected: 2,
};

function buildStatus(
  config: ManagedSocialChannel,
  bundle: ConnectionBundle,
  productId?: string,
): ManagedSocialChannelStatus {
  const adapter = getAdapterForChannel(config.channel);

  if (!adapter) {
    return {
      ...config,
      state: 'disconnected',
      reason: 'No publishing adapter is registered for this channel.',
      provider: null,
      connectionScope: null,
      destinationLabel: null,
      destinations: [],
      capabilities: [],
      lastRefreshError: null,
      tokenExchangeDegraded: false,
    };
  }

  const matches = findConnectionsForChannel(bundle, config.channel, productId);
  const destinations = matches.map((match) => buildDestination(match, config, adapter));

  if (destinations.length === 0) {
    return {
      ...config,
      state: 'disconnected',
      reason: config.setupHint,
      provider: null,
      connectionScope: null,
      destinationLabel: null,
      destinations: [],
      capabilities: [...adapter.capabilities],
      lastRefreshError: null,
      tokenExchangeDegraded: false,
    };
  }

  // The channel is as healthy as its best destination — one broken Page must
  // not blank out the other nine.
  const primary = [...destinations].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state])[0];

  return {
    ...config,
    state: primary.state,
    reason: primary.reason,
    provider: primary.provider,
    connectionScope: primary.scope,
    destinationLabel: primary.label,
    destinations,
    capabilities: [...adapter.capabilities],
    lastRefreshError: primary.lastRefreshError,
    // Any connection serving this channel running on a short-lived token is
    // enough to flag it: the channel is only as durable as the credential the
    // next publish happens to pick.
    tokenExchangeDegraded: matches.some(
      (match) => match.connection.metadata?.tokenExchangeDegraded === true,
    ),
  };
}

export async function listManagedSocialChannelStatuses(
  workspaceId: string,
  productId?: string,
): Promise<ManagedSocialChannelStatus[]> {
  const [workspace, product] = await Promise.all([
    listConnections(workspaceId),
    productId ? listConnections(workspaceId, productId) : Promise.resolve([]),
  ]);

  return socialChannelCatalog.map((config) => buildStatus(config, { workspace, product }, productId));
}

/**
 * How many brands the workspace-wide health sweep will walk. A workspace past
 * this is far beyond every current plan's brand limit; the sweep still runs,
 * it just stops adding reads.
 */
const HEALTH_SWEEP_MAX_PRODUCTS = 50;

/**
 * Workspace-wide channel health: the union of every REAL linked account
 * across every brand, worst state per channel.
 *
 * Exists because the health banner used to call
 * `listManagedSocialChannelStatuses(workspaceId)` with no product, which can
 * only see workspace-scoped connections. Publishing connections live on
 * brands, so the only thing that call ever saw for Facebook was the
 * workspace-level Meta *credential*, which by design has no Page selected.
 * The adapter dutifully reported "No Facebook page selected", and every
 * workspace with perfectly healthy brand-level Pages showed a permanent
 * "Facebook is not connected" banner.
 *
 * Two deliberate choices:
 * - Meta rows count only when they carry a Page (`metadata.pageId`). The
 *   page-less credential is an auth artifact, not a publish target, and a
 *   brand that authorized Meta but never picked a Page is a choice to finish
 *   setup, not breakage.
 * - The row's reason is prefixed with the brand name, because "Facebook is
 *   not ready" is not actionable in a workspace with six brands on Facebook.
 */
export async function listWorkspaceChannelHealth(
  workspaceId: string,
): Promise<ManagedSocialChannelStatus[]> {
  const productsSnap = await adminDb
    .collection(`workspaces/${workspaceId}/products`)
    .limit(HEALTH_SWEEP_MAX_PRODUCTS)
    .get();

  const workspace = await listConnections(workspaceId);
  const productScopes = await Promise.all(productsSnap.docs.map(async (doc) => ({
    productId: doc.id,
    productName: typeof doc.data().name === 'string' ? doc.data().name : doc.id,
    connections: await listConnections(workspaceId, doc.id),
  })));

  return socialChannelCatalog.map((config) => {
    const adapter = getAdapterForChannel(config.channel);
    const destinations: ManagedSocialChannelDestination[] = [];
    let tokenExchangeDegraded = false;

    const collect = (bundle: ConnectionBundle, productId: string | undefined, productName: string | null) => {
      if (!adapter) return;
      for (const match of findConnectionsForChannel(bundle, config.channel, productId)) {
        // Real publish targets only: a Meta connection without a selected
        // Page is a credential, and reporting it as a broken destination is
        // exactly the false positive this function exists to end.
        if (match.connection.provider === 'meta' && !match.connection.metadata?.pageId) continue;
        const destination = buildDestination(match, config, adapter);
        destinations.push({
          ...destination,
          reason: destination.reason && productName
            ? `${productName}: ${destination.reason}`
            : destination.reason,
        });
        if (match.connection.metadata?.tokenExchangeDegraded === true) tokenExchangeDegraded = true;
      }
    };

    // Workspace-scoped real accounts first, then every brand's.
    collect({ workspace, product: [] }, undefined, null);
    for (const scope of productScopes) {
      collect({ workspace: [], product: scope.connections }, scope.productId, scope.productName);
    }

    const worst = destinations.reduce<ManagedSocialChannelDestination | null>(
      (acc, dest) => (!acc || STATE_RANK[dest.state] > STATE_RANK[acc.state] ? dest : acc),
      null,
    );

    return {
      ...config,
      state: worst?.state ?? 'disconnected',
      reason: worst?.state !== 'ready' ? worst?.reason ?? null : null,
      provider: worst?.provider ?? null,
      connectionScope: worst?.scope ?? null,
      destinationLabel: worst?.label ?? null,
      destinations,
      capabilities: [],
      lastRefreshError: worst?.lastRefreshError ?? null,
      tokenExchangeDegraded,
    };
  });
}

/**
 * Channels a post cannot be published to. When the post names a specific
 * destination, that destination — not merely the channel — must be ready.
 */
export async function getUnavailableSocialChannels(
  workspaceId: string,
  productId: string | undefined,
  channels: SocialChannel[],
  destinationIds?: Partial<Record<SocialChannel, string | undefined>>,
): Promise<Array<{ channel: SocialChannel; reason: string }>> {
  const statuses = await listManagedSocialChannelStatuses(workspaceId, productId);
  const byChannel = new Map(statuses.map((status) => [status.channel, status]));

  return channels.flatMap((channel) => {
    const status = byChannel.get(channel);
    if (!status) {
      return [{ channel, reason: `${channel} is not connected for this brand.` }];
    }

    const requestedId = destinationIds?.[channel];
    if (requestedId) {
      const requested = normalizeDestinationId(requestedId);
      const destination = status.destinations.find(
        (dest) => dest.destinationId === requestedId ||
          (dest.destinationId ? normalizeDestinationId(dest.destinationId) === requested : false),
      );
      if (!destination) {
        return [{
          channel,
          reason: `The selected ${status.label} account is no longer linked to this brand.`,
        }];
      }
      if (destination.state !== 'ready') {
        return [{
          channel,
          reason: destination.reason || `${status.label} is not ready to publish.`,
        }];
      }
      return [];
    }

    if (status.state === 'ready') return [];
    return [{
      channel,
      reason: status.reason || `${channel} is not connected for this brand.`,
    }];
  });
}
