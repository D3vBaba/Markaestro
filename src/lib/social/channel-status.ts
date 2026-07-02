import { getAdapterForChannel } from '@/lib/platform/registry';
import { listConnections } from '@/lib/platform/connections';
import type { PlatformAdapter, PlatformConnection } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import {
  getSocialChannelProviderKeys,
  socialChannelCatalog,
  type ManagedSocialChannel,
} from '@/lib/social/channel-catalog';

export type ManagedSocialChannelState = 'ready' | 'needs_setup' | 'disconnected';

export type ManagedSocialChannelStatus = ManagedSocialChannel & {
  state: ManagedSocialChannelState;
  reason: string | null;
  provider: string | null;
  connectionScope: 'workspace' | 'product' | null;
  destinationLabel: string | null;
  capabilities: string[];
  lastRefreshError?: string | null;
};

type ConnectionBundle = {
  workspace: PlatformConnection[];
  product: PlatformConnection[];
};

function mergeMetaConnection(
  workspaceConnection: PlatformConnection | undefined,
  productConnection: PlatformConnection | undefined,
  productId?: string,
): PlatformConnection | undefined {
  if (workspaceConnection && productConnection) {
    return {
      ...workspaceConnection,
      // Readiness follows the product connection, which owns the publishing
      // destination (selected Page + linked IG business account) and a
      // long-lived Page access token. Page/IG publishing uses that Page token
      // (see resolveAccessToken), not the workspace user token — so a lapsed
      // 60-day user token (workspace status 'error'/'expired') must not blur out
      // an otherwise-valid channel. The workspace connection still supplies the
      // user token for account/ads APIs and its availablePages metadata.
      status: productConnection.status,
      productId,
      metadata: {
        ...workspaceConnection.metadata,
        ...productConnection.metadata,
      },
    };
  }

  return productConnection ?? workspaceConnection;
}

function findProviderConnection(
  bundle: ConnectionBundle,
  provider: string,
  productId?: string,
): { connection: PlatformConnection; scope: 'workspace' | 'product' } | null {
  const workspaceConnection = bundle.workspace.find((conn) => conn.provider === provider);
  const productConnection = bundle.product.find((conn) => conn.provider === provider);

  if (provider === 'meta') {
    const merged = mergeMetaConnection(workspaceConnection, productConnection, productId);
    if (!merged) return null;
    return {
      connection: merged,
      scope: productConnection ? 'product' : 'workspace',
    };
  }

  if (productConnection) {
    return { connection: productConnection, scope: 'product' };
  }

  if (workspaceConnection) {
    return { connection: workspaceConnection, scope: 'workspace' };
  }

  return null;
}

type ChannelConnectionMatch = { connection: PlatformConnection; scope: 'workspace' | 'product' };

function findConnectionForChannel(
  bundle: ConnectionBundle,
  channel: SocialChannel,
  adapter: PlatformAdapter | undefined,
  productId?: string,
): ChannelConnectionMatch | null {
  const candidates = getSocialChannelProviderKeys(channel)
    .map((provider) => findProviderConnection(bundle, provider, productId))
    .filter((match): match is ChannelConnectionMatch => Boolean(match));

  // A channel can be served by more than one provider (e.g. Instagram via the
  // standalone Instagram Login connection or via the Meta Page's linked IG
  // business account; LinkedIn via profile/community/public credentials).
  // Prefer the candidate that is actually ready to publish so one provider's
  // incomplete setup can't shadow another provider's working connection.
  // Fall back to a connected-but-unconfigured candidate (surfaces its setup
  // hint), then to anything present (surfaces the reconnect message).
  return (
    candidates.find((match) =>
      match.connection.status === 'connected' &&
      (!adapter || adapter.validateConnection(match.connection, channel) === null)
    ) ||
    candidates.find((match) => match.connection.status === 'connected') ||
    candidates[0] ||
    null
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

function buildStatus(
  config: ManagedSocialChannel,
  bundle: ConnectionBundle,
  productId?: string,
): ManagedSocialChannelStatus {
  const adapter = getAdapterForChannel(config.channel);
  const match = findConnectionForChannel(bundle, config.channel, adapter, productId);

  if (!adapter) {
    return {
      ...config,
      state: 'disconnected',
      reason: 'No publishing adapter is registered for this channel.',
      provider: null,
      connectionScope: null,
      destinationLabel: null,
      capabilities: [],
      lastRefreshError: null,
    };
  }

  if (!match) {
    return {
      ...config,
      state: 'disconnected',
      reason: config.setupHint,
      provider: null,
      connectionScope: null,
      destinationLabel: null,
      capabilities: [...adapter.capabilities],
      lastRefreshError: null,
    };
  }

  if (match.connection.status !== 'connected') {
    const refreshError = typeof match.connection.metadata.lastRefreshError === 'string'
      ? match.connection.metadata.lastRefreshError
      : null;
    return {
      ...config,
      state: 'disconnected',
      reason: refreshError || `${config.label} connection is ${match.connection.status}. Reconnect it in product settings.`,
      provider: match.connection.provider,
      connectionScope: match.scope,
      destinationLabel: getDestinationLabel(match.connection, config.channel),
      capabilities: [...adapter.capabilities],
      lastRefreshError: refreshError,
    };
  }

  const validationError = adapter.validateConnection(match.connection, config.channel);
  const state: ManagedSocialChannelState = validationError ? 'needs_setup' : 'ready';

  return {
    ...config,
    state,
    reason: validationError,
    provider: match.connection.provider,
    connectionScope: match.scope,
    destinationLabel: getDestinationLabel(match.connection, config.channel),
    capabilities: [...adapter.capabilities],
    lastRefreshError: typeof match.connection.metadata.lastRefreshError === 'string'
      ? match.connection.metadata.lastRefreshError
      : null,
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

export async function getUnavailableSocialChannels(
  workspaceId: string,
  productId: string | undefined,
  channels: SocialChannel[],
): Promise<Array<{ channel: SocialChannel; reason: string }>> {
  const statuses = await listManagedSocialChannelStatuses(workspaceId, productId);
  const byChannel = new Map(statuses.map((status) => [status.channel, status]));

  return channels.flatMap((channel) => {
    const status = byChannel.get(channel);
    if (status?.state === 'ready') return [];
    return [{
      channel,
      reason: status?.reason || `${channel} is not connected for this product.`,
    }];
  });
}
