import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The health banner showed "Facebook is not connected" on a workspace with
 * six healthy brand-level Page connections. The product-less status call can
 * only see workspace-scoped connections, and for Meta that is the page-less
 * CREDENTIAL, which the adapter correctly reports as "No Facebook page
 * selected" — correct per object, wrong as workspace health.
 *
 * These tests mirror the exact production shape that surfaced the bug: one
 * workspace Meta credential with no pageId, Pages linked per brand.
 */

const listConnectionsMock = vi.fn();
const productDocs: Array<{ id: string; data: () => Record<string, unknown> }> = [];

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: () => ({
      limit: () => ({ get: async () => ({ docs: productDocs }) }),
    }),
  },
}));

vi.mock('@/lib/platform/connections', () => ({
  listConnections: (workspaceId: string, productId?: string) =>
    listConnectionsMock(workspaceId, productId),
}));

vi.mock('@/lib/platform/registry', () => ({
  getAdapterForChannel: () => ({
    capabilities: [],
    validateConnection: (connection: { provider: string; metadata?: Record<string, unknown> }) => {
      if (connection.provider === 'meta' && !connection.metadata?.pageId) {
        return 'No Facebook page selected';
      }
      return null;
    },
  }),
}));

function connection(overrides: Record<string, unknown>) {
  return {
    connectionId: 'conn',
    provider: 'meta',
    status: 'connected',
    accessTokenEncrypted: 'enc',
    channels: ['facebook'],
    metadata: {},
    ...overrides,
  };
}

function setProducts(products: Array<{ id: string; name: string }>) {
  productDocs.length = 0;
  for (const product of products) {
    productDocs.push({ id: product.id, data: () => ({ name: product.name }) });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listWorkspaceChannelHealth', () => {
  it('does not report the page-less workspace Meta credential as a broken Facebook destination', async () => {
    // The production shape: healthy credential at workspace scope, healthy
    // Pages on brands. The old code path reported facebook as needs_setup.
    setProducts([{ id: 'p1', name: 'Skyyn' }]);
    listConnectionsMock.mockImplementation(async (_ws: string, productId?: string) => {
      if (!productId) {
        return [connection({ connectionId: 'meta:cred', metadata: {} })];
      }
      return [connection({
        connectionId: 'meta:page1',
        metadata: { pageId: 'page1', pageName: 'Skyyn Page' },
      })];
    });

    const { listWorkspaceChannelHealth } = await import('../social/channel-status');
    const statuses = await listWorkspaceChannelHealth('ws1');
    const facebook = statuses.find((status) => status.channel === 'facebook')!;

    expect(facebook.state).toBe('ready');
    expect(facebook.reason).toBeNull();
    // Exactly the one real Page; the credential is not a destination.
    expect(facebook.destinations).toHaveLength(1);
    expect(facebook.destinations[0].label).toBe('Skyyn Page');
  });

  it('still names a genuinely broken brand-level Page in destinations, without flipping a healthy workspace to not-ready', async () => {
    setProducts([
      { id: 'p1', name: 'Skyyn' },
      { id: 'p2', name: 'EyeCash' },
    ]);
    listConnectionsMock.mockImplementation(async (_ws: string, productId?: string) => {
      if (!productId) return [connection({ connectionId: 'meta:cred', metadata: {} })];
      if (productId === 'p1') {
        return [connection({
          connectionId: 'meta:page1',
          metadata: { pageId: 'page1', pageName: 'Skyyn Page' },
        })];
      }
      return [connection({
        connectionId: 'meta:page2',
        status: 'expired',
        metadata: { pageId: 'page2', pageName: 'EyeCash Page' },
      })];
    });

    const { listWorkspaceChannelHealth } = await import('../social/channel-status');
    const facebook = (await listWorkspaceChannelHealth('ws1'))
      .find((status) => status.channel === 'facebook')!;

    // Settings shows Linked when any Page is ready. The workspace banner
    // used to use worst-state, so EyeCash's expired Page painted "Facebook
    // is not connected" over Skyyn's healthy one.
    expect(facebook.state).toBe('ready');
    expect(facebook.reason).toBeNull();
    expect(facebook.destinations).toHaveLength(2);
    expect(facebook.destinations.some((dest) => dest.state === 'disconnected')).toBe(true);
  });

  it('does not report a boardless Pinterest leftover as a broken destination', async () => {
    // Same shape as the Facebook page-less credential: after a board is
    // picked, the pending grant document stays behind with no boardId.
    // Workspace health used worst-state, so that leftover marked Pinterest
    // "not ready" while Settings still showed Linked for the real board.
    setProducts([{ id: 'drip', name: 'DripCheckr' }]);
    listConnectionsMock.mockImplementation(async (_ws: string, productId?: string) => {
      if (!productId) return [];
      return [
        connection({
          provider: 'pinterest',
          connectionId: 'pinterest:1134555468535481313',
          metadata: {},
        }),
        connection({
          provider: 'pinterest',
          connectionId: 'pinterest:1134555399818043261',
          metadata: { boardId: '1134555399818043261', boardName: 'DripCheckr Brand' },
        }),
      ];
    });

    const { listWorkspaceChannelHealth } = await import('../social/channel-status');
    const pinterest = (await listWorkspaceChannelHealth('ws1'))
      .find((status) => status.channel === 'pinterest')!;

    expect(pinterest.state).toBe('ready');
    expect(pinterest.reason).toBeNull();
    expect(pinterest.destinations).toHaveLength(1);
    expect(pinterest.destinations[0].label).toBe('DripCheckr Brand');
  });

  it('treats Pinterest with only a leftover grant as having no destinations', async () => {
    setProducts([{ id: 'drip', name: 'DripCheckr' }]);
    listConnectionsMock.mockImplementation(async (_ws: string, productId?: string) => {
      if (!productId) return [];
      return [connection({
        provider: 'pinterest',
        connectionId: 'pinterest:cred',
        metadata: {},
      })];
    });

    const { listWorkspaceChannelHealth } = await import('../social/channel-status');
    const pinterest = (await listWorkspaceChannelHealth('ws1'))
      .find((status) => status.channel === 'pinterest')!;

    expect(pinterest.destinations).toHaveLength(0);
    expect(pinterest.state).toBe('disconnected');
  });

  it('does not let one brand\'s broken Pinterest override another brand\'s Linked board', async () => {
    // Production shape after the leftover skip: DripCheckr has a healthy
    // board (Settings: Linked) and Markaestro has a board whose grant is
    // in error. Worst-state still painted the workspace banner.
    setProducts([
      { id: 'drip', name: 'DripCheckr' },
      { id: 'mk', name: 'Markaestro' },
    ]);
    listConnectionsMock.mockImplementation(async (_ws: string, productId?: string) => {
      if (productId === 'drip') {
        return [connection({
          provider: 'pinterest',
          connectionId: 'pinterest:board',
          metadata: { boardId: 'board-drip', boardName: 'DripCheckr Brand' },
        })];
      }
      if (productId === 'mk') {
        return [connection({
          provider: 'pinterest',
          connectionId: 'pinterest',
          status: 'error',
          metadata: { boardId: 'board-mk', boardName: 'Markaestro API Test' },
        })];
      }
      return [];
    });

    const { listWorkspaceChannelHealth } = await import('../social/channel-status');
    const pinterest = (await listWorkspaceChannelHealth('ws1'))
      .find((status) => status.channel === 'pinterest')!;

    expect(pinterest.state).toBe('ready');
    expect(pinterest.reason).toBeNull();
    expect(pinterest.destinationLabel).toBe('DripCheckr Brand');
  });

  it('still banners Pinterest when every real board is unusable', async () => {
    setProducts([{ id: 'mk', name: 'Markaestro' }]);
    listConnectionsMock.mockImplementation(async (_ws: string, productId?: string) => {
      if (!productId) return [];
      return [connection({
        provider: 'pinterest',
        connectionId: 'pinterest',
        status: 'error',
        metadata: { boardId: 'board-mk', boardName: 'Markaestro API Test' },
      })];
    });

    const { listWorkspaceChannelHealth } = await import('../social/channel-status');
    const pinterest = (await listWorkspaceChannelHealth('ws1'))
      .find((status) => status.channel === 'pinterest')!;

    expect(pinterest.state).toBe('disconnected');
    expect(pinterest.destinations).toHaveLength(1);
  });

  it('does not report a LinkedIn leftover without a destination as a broken channel', async () => {
    setProducts([{ id: 'aethos', name: 'Aethos Solutions' }]);
    listConnectionsMock.mockImplementation(async (_ws: string, productId?: string) => {
      if (!productId) return [];
      return [
        connection({
          provider: 'linkedin_community',
          connectionId: 'linkedin_community:EJvBa9HTWE',
          metadata: {},
        }),
        connection({
          provider: 'linkedin_community',
          connectionId: 'linkedin_community:urn:li:organization:114364478',
          metadata: {
            linkedinDestinationUrn: 'urn:li:organization:114364478',
            linkedinDestinationName: 'Aethos Solutions',
          },
        }),
      ];
    });

    const { listWorkspaceChannelHealth } = await import('../social/channel-status');
    const linkedin = (await listWorkspaceChannelHealth('ws1'))
      .find((status) => status.channel === 'linkedin')!;

    expect(linkedin.state).toBe('ready');
    expect(linkedin.destinations).toHaveLength(1);
  });

  it('reports a channel with no real accounts anywhere as having no destinations', async () => {
    // The banner filter is destinations.length > 0 && state !== ready; a
    // never-connected channel must stay invisible to it.
    setProducts([{ id: 'p1', name: 'Skyyn' }]);
    listConnectionsMock.mockImplementation(async (_ws: string, productId?: string) =>
      productId ? [] : [connection({ connectionId: 'meta:cred', metadata: {} })]);

    const { listWorkspaceChannelHealth } = await import('../social/channel-status');
    const facebook = (await listWorkspaceChannelHealth('ws1'))
      .find((status) => status.channel === 'facebook')!;

    expect(facebook.destinations).toHaveLength(0);
  });
});
