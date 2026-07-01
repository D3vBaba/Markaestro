import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnection } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';

const listConnectionsMock = vi.fn();
const getAdapterForChannelMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));

vi.mock('@/lib/platform/connections', () => ({
  listConnections: listConnectionsMock,
}));

vi.mock('@/lib/platform/registry', () => ({
  getAdapterForChannel: getAdapterForChannelMock,
}));

// Mirror the real Meta adapter's readiness check: Facebook needs a selected
// page, Instagram needs a linked IG business account.
const metaAdapter = {
  capabilities: ['publish_text', 'publish_image'],
  validateConnection(connection: PlatformConnection, channel: SocialChannel): string | null {
    if (channel === 'facebook' && !connection.metadata.pageId) return 'No Facebook page selected';
    if (channel === 'instagram' && !connection.metadata.igAccountId) return 'No Instagram business account linked';
    return null;
  },
};

function conn(overrides: Partial<PlatformConnection>): PlatformConnection {
  return {
    provider: 'meta',
    status: 'connected',
    accessTokenEncrypted: 'enc',
    metadata: {},
    workspaceId: 'default',
    ...overrides,
  } as PlatformConnection;
}

describe('listManagedSocialChannelStatuses — Meta workspace/product merge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdapterForChannelMock.mockReturnValue(metaAdapter);
  });

  it('keeps Instagram/Facebook ready when the product Page connection is valid but the workspace user token lapsed', async () => {
    // Workspace-level Meta: expired 60-day user token, refresh gave up → 'error'.
    const workspaceMeta = conn({
      status: 'error',
      metadata: { refreshFailureCount: 5, lastRefreshError: 'Token refresh failed for meta', pageSelectionRequired: true },
    });
    // Product-level Meta: selected Page + linked IG + long-lived Page token.
    const productMeta = conn({
      status: 'connected',
      productId: 'prod_1',
      metadata: {
        pageId: '887940481074439',
        pageName: 'EyeCash Budgeting',
        igAccountId: '17841418357332443',
        pageAccessTokenEncrypted: 'enc-page',
        pageSelectionRequired: false,
      },
    });

    listConnectionsMock.mockImplementation((_wid: string, pid?: string) => (pid ? [productMeta] : [workspaceMeta]));

    const { listManagedSocialChannelStatuses } = await import('@/lib/social/channel-status');
    const statuses = await listManagedSocialChannelStatuses('default', 'prod_1');
    const byChannel = new Map(statuses.map((s) => [s.channel, s]));

    expect(byChannel.get('instagram')?.state).toBe('ready');
    expect(byChannel.get('facebook')?.state).toBe('ready');
    expect(byChannel.get('instagram')?.destinationLabel).toBe(null); // no username on this legacy conn
  });

  it('reports disconnected when the product Page connection itself is not connected', async () => {
    const workspaceMeta = conn({ status: 'connected' });
    const productMeta = conn({
      status: 'error',
      productId: 'prod_1',
      metadata: { pageId: '1', igAccountId: '2', lastRefreshError: 'page token revoked' },
    });

    listConnectionsMock.mockImplementation((_wid: string, pid?: string) => (pid ? [productMeta] : [workspaceMeta]));

    const { listManagedSocialChannelStatuses } = await import('@/lib/social/channel-status');
    const statuses = await listManagedSocialChannelStatuses('default', 'prod_1');
    const instagram = statuses.find((s) => s.channel === 'instagram');

    expect(instagram?.state).toBe('disconnected');
  });
});
