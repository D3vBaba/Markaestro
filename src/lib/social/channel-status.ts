import { getAdapterForChannel } from '@/lib/platform/registry';
import { listConnections } from '@/lib/platform/connections';
import type { PlatformConnection } from '@/lib/platform/types';
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

function findConnectionForChannel(
  bundle: ConnectionBundle,
  channel: SocialChannel,
  productId?: string,
): { connection: PlatformConnection; scope: 'workspace' | 'product' } | null {
  for (const provider of getSocialChannelProviderKeys(channel)) {
    const match = findProviderConnection(bundle, provider, productId);
    if (match) return match;
  }
  return null;
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

  return null;
}

function buildStatus(
  config: ManagedSocialChannel,
  bundle: ConnectionBundle,
  productId?: string,
): ManagedSocialChannelStatus {
  const adapter = getAdapterForChannel(config.channel);
  const match = findConnectionForChannel(bundle, config.channel, productId);

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
