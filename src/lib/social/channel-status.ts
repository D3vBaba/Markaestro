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

  if (channel === 'instagram' || channel === 'threads' || channel === 'tiktok' || channel === 'x') {
    return typeof metadata.username === 'string' && metadata.username ? metadata.username : null;
  }

  if (channel === 'pinterest') {
    return typeof metadata.boardName === 'string' && metadata.boardName ? metadata.boardName : null;
  }

  if (channel === 'youtube') {
    return typeof metadata.channelTitle === 'string' && metadata.channelTitle ? metadata.channelTitle : null;
  }

  if (channel === 'linkedin') {
    return typeof metadata.displayName === 'string' && metadata.displayName ? metadata.displayName : null;
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
    };
  }

  if (match.connection.status !== 'connected') {
    return {
      ...config,
      state: 'disconnected',
      reason: config.setupHint,
      provider: match.connection.provider,
      connectionScope: match.scope,
      destinationLabel: getDestinationLabel(match.connection, config.channel),
      capabilities: [...adapter.capabilities],
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
