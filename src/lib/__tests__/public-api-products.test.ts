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

  it('lists linked Meta and TikTok destinations for a product', async () => {
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
    getConnectionMock.mockResolvedValue({
      status: 'connected',
      productId: 'prod_123',
      workspaceId: 'ws_123',
      metadata: {
        username: 'acmebrand',
        openId: 'tt_open_123',
      },
    });

    const destinations = await listPublicProductDestinations('ws_123', 'prod_123');

    expect(destinations).toEqual([
      expect.objectContaining({
        provider: 'meta',
        channel: 'facebook',
        accountId: 'pg_123',
        willAlsoPublishTo: ['instagram'],
      }),
      expect.objectContaining({
        provider: 'meta',
        channel: 'instagram',
        accountId: 'ig_123',
        willAlsoPublishTo: ['facebook'],
      }),
      expect.objectContaining({
        provider: 'tiktok',
        channel: 'tiktok',
        accountId: 'tt_open_123',
        deliveryMode: 'user_review',
      }),
    ]);
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
});
