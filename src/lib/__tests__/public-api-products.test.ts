import { beforeEach, describe, expect, it, vi } from 'vitest';

const collectionMock = vi.fn();
const docMock = vi.fn();
const getMetaConnectionMergedMock = vi.fn();
const getConnectionMock = vi.fn();
const getConnectionForChannelMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: collectionMock,
    doc: docMock,
  },
}));

vi.mock('@/lib/firestore-paths', () => ({
  workspaceCollection: (workspaceId: string, collection: string) => `workspaces/${workspaceId}/${collection}`,
}));

vi.mock('@/lib/platform/connections', () => ({
  getMetaConnectionMerged: getMetaConnectionMergedMock,
  getConnection: getConnectionMock,
  getConnectionForChannel: getConnectionForChannelMock,
}));

describe('public product discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists linked Meta and Markaestro TikTok draft destinations for a product', async () => {
    const { listPublicProductDestinations } = await import('../public-api/products');

    docMock.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ name: 'Acme', status: 'active', categories: ['saas'] }),
      }),
    });

    getMetaConnectionMergedMock.mockResolvedValue({
      status: 'connected',
      metadata: {
        pageId: 'pg_123',
        pageName: 'Acme Page',
        igAccountId: 'ig_123',
      },
    });
    getConnectionMock.mockImplementation(async (_workspaceId: string, provider: string) => {
      if (provider === 'instagram') return null;
      if (provider === 'tiktok') {
        return {
          status: 'connected',
          productId: 'prod_123',
          workspaceId: 'ws_123',
          metadata: {
            username: 'acmebrand',
            openId: 'tt_open_123',
          },
        };
      }
      return null;
    });

    const destinations = await listPublicProductDestinations('ws_123', 'prod_123');

    expect(destinations).toEqual([
      expect.objectContaining({
        provider: 'meta',
        channel: 'facebook',
        id: 'meta:facebook:pg_123',
        accountId: 'pg_123',
        willAlsoPublishTo: ['instagram'],
      }),
      expect.objectContaining({
        provider: 'meta',
        channel: 'instagram',
        id: 'meta:instagram:ig_123',
        accountId: 'ig_123',
        willAlsoPublishTo: ['facebook'],
      }),
      expect.objectContaining({
        provider: 'tiktok',
        channel: 'tiktok',
        id: 'tiktok:tiktok:markaestro_drafts_prod_123',
        accountId: 'markaestro_drafts_prod_123',
        deliveryMode: 'user_review',
        displayName: 'acmebrand (Markaestro drafts)',
      }),
    ]);
  });

  it('exposes a TikTok draft destination even when no TikTok account is connected', async () => {
    const { listPublicProductDestinations } = await import('../public-api/products');

    docMock.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ name: 'Acme', status: 'active', categories: ['saas'] }),
      }),
    });

    getMetaConnectionMergedMock.mockResolvedValue(null);
    getConnectionMock.mockResolvedValue(null);

    const destinations = await listPublicProductDestinations('ws_123', 'prod_123');

    expect(destinations).toEqual([
      expect.objectContaining({
        provider: 'tiktok',
        channel: 'tiktok',
        id: 'tiktok:tiktok:markaestro_drafts_prod_123',
        accountId: 'markaestro_drafts_prod_123',
        displayName: 'Acme TikTok drafts',
        deliveryMode: 'user_review',
      }),
    ]);
  });

  it('lists standalone instagram login destinations separately from meta-linked instagram', async () => {
    const { listPublicProductDestinations } = await import('../public-api/products');

    docMock.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ name: 'Acme', status: 'active', categories: ['saas'] }),
      }),
    });

    getMetaConnectionMergedMock.mockResolvedValue({
      status: 'connected',
      metadata: {
        pageId: 'pg_123',
        pageName: 'Acme Page',
        igAccountId: 'ig_meta_123',
      },
    });
    getConnectionMock.mockImplementation(async (_workspaceId: string, provider: string) => {
      if (provider === 'instagram') {
        return {
          status: 'connected',
          productId: 'prod_123',
          workspaceId: 'ws_123',
          metadata: {
            igAccountId: 'ig_direct_123',
            username: 'acme_direct',
            displayName: 'Acme Direct',
          },
        };
      }
      return null;
    });

    const destinations = await listPublicProductDestinations('ws_123', 'prod_123');

    expect(destinations).toContainEqual(expect.objectContaining({
      id: 'instagram:instagram:ig_direct_123',
      provider: 'instagram',
      channel: 'instagram',
      accountId: 'ig_direct_123',
      username: 'acme_direct',
      willAlsoPublishTo: [],
    }));
  });

  it('requires productId when multiple products can publish to the same channel', async () => {
    const { resolvePublicPostProductId } = await import('../public-api/products');

    collectionMock.mockReturnValue({
      orderBy: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          docs: [
            { id: 'prod_a', data: () => ({ name: 'A' }) },
            { id: 'prod_b', data: () => ({ name: 'B' }) },
          ],
        }),
      }),
    });

    docMock.mockImplementation((path: string) => ({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ name: path.includes('prod_a') ? 'A' : 'B' }),
      }),
    }));

    getMetaConnectionMergedMock.mockImplementation(async (_workspaceId: string, productId?: string) => {
      if (!productId) return null;
      return {
        status: 'connected',
        metadata: {
          pageId: `${productId}_page`,
          pageName: productId,
        },
      };
    });
    getConnectionMock.mockResolvedValue(null);
    getConnectionForChannelMock.mockResolvedValue(null);

    await expect(resolvePublicPostProductId('ws_123', 'facebook')).rejects.toThrow(
      'VALIDATION_PRODUCT_ID_REQUIRED_FOR_CHANNEL',
    );
  });

  it('requires destinationId when one product has multiple instagram destinations', async () => {
    const { resolvePublicPostDestination } = await import('../public-api/products');

    docMock.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ name: 'Acme', status: 'active', categories: ['saas'] }),
      }),
    });

    getMetaConnectionMergedMock.mockResolvedValue({
      status: 'connected',
      metadata: {
        pageId: 'pg_123',
        pageName: 'Acme Page',
        igAccountId: 'ig_meta_123',
      },
    });
    getConnectionMock.mockImplementation(async (_workspaceId: string, provider: string) => {
      if (provider === 'instagram') {
        return {
          status: 'connected',
          productId: 'prod_123',
          workspaceId: 'ws_123',
          metadata: {
            igAccountId: 'ig_direct_123',
            username: 'acme_direct',
          },
        };
      }
      return null;
    });

    await expect(
      resolvePublicPostDestination('ws_123', 'instagram', 'prod_123'),
    ).rejects.toThrow('VALIDATION_DESTINATION_ID_REQUIRED_FOR_CHANNEL');
  });
});
