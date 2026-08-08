import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnection } from '@/lib/platform/types';

const getDocMock = vi.fn();
const getCollectionMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: (path: string) => ({
      get: () => getDocMock(path),
    }),
    collection: (path: string) => ({
      doc: (id: string) => ({
        id,
        path: `${path}/${id}`,
        get: () => getDocMock(`${path}/${id}`),
      }),
      get: () => getCollectionMock(path),
    }),
  },
}));

function snapshot(connection: PlatformConnection | null) {
  return {
    exists: Boolean(connection),
    data: () => connection,
  };
}

/** A `platformConnections` collection listing, as listConnections reads it. */
function collectionSnapshot(entries: Array<[string, PlatformConnection]>) {
  return {
    docs: entries.map(([id, data]) => ({ id, data: () => data })),
  };
}

function connection(
  overrides: Partial<PlatformConnection> = {},
): PlatformConnection {
  return {
    provider: 'meta',
    channels: ['facebook'],
    capabilities: [],
    status: 'connected',
    accessTokenEncrypted: 'credential',
    metadata: {},
    workspaceId: 'workspace_1',
    updatedBy: 'user_1',
    updatedAt: '2026-08-05T00:00:00.000Z',
    createdAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

const WORKSPACE_CREDENTIAL_PATH = 'workspaces/workspace_1/platformConnections/meta';
const PRODUCT_COLLECTION_PATH = 'workspaces/workspace_1/products/product_1/platformConnections';

describe('getMetaConnectionMerged', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCollectionMock.mockResolvedValue(collectionSnapshot([]));
  });

  it('uses the workspace user credential with the product Page selection', async () => {
    const workspace = connection({
      accessTokenEncrypted: 'workspace-user-token',
      metadata: { availablePages: [{ id: 'page_1', name: 'Page One' }] },
    });
    const product = connection({
      productId: 'product_1',
      accessTokenEncrypted: 'stale-product-user-token',
      metadata: {
        pageId: 'page_1',
        pageName: 'Page One',
        pageAccessTokenEncrypted: 'product-page-token',
      },
    });
    getDocMock.mockImplementation((path: string) =>
      path === WORKSPACE_CREDENTIAL_PATH ? snapshot(workspace) : snapshot(null),
    );
    getCollectionMock.mockImplementation(async (path: string) =>
      path === PRODUCT_COLLECTION_PATH
        ? collectionSnapshot([['meta:page_1', product]])
        : collectionSnapshot([]),
    );

    const { getMetaConnectionMerged } = await import('@/lib/platform/connections');
    const merged = await getMetaConnectionMerged('workspace_1', 'product_1');

    expect(merged?.accessTokenEncrypted).toBe('workspace-user-token');
    expect(merged?.productId).toBe('product_1');
    expect(merged?.metadata).toEqual(expect.objectContaining({
      pageId: 'page_1',
      pageAccessTokenEncrypted: 'product-page-token',
      availablePages: [{ id: 'page_1', name: 'Page One' }],
    }));
  });

  it('uses the product status so a revoked Page cannot appear publishable', async () => {
    const workspace = connection({ status: 'connected' });
    const product = connection({
      status: 'revoked',
      productId: 'product_1',
      metadata: { pageId: 'page_1' },
    });
    getDocMock.mockImplementation((path: string) =>
      path === WORKSPACE_CREDENTIAL_PATH ? snapshot(workspace) : snapshot(null),
    );
    getCollectionMock.mockImplementation(async (path: string) =>
      path === PRODUCT_COLLECTION_PATH
        ? collectionSnapshot([['meta:page_1', product]])
        : collectionSnapshot([]),
    );

    const { getMetaConnectionMerged } = await import('@/lib/platform/connections');
    const merged = await getMetaConnectionMerged('workspace_1', 'product_1');

    expect(merged?.status).toBe('revoked');
  });

  it('falls back to a legacy product credential when no workspace credential exists', async () => {
    const product = connection({
      productId: 'product_1',
      accessTokenEncrypted: 'legacy-product-token',
      metadata: { pageId: 'page_1' },
    });
    getDocMock.mockImplementation(() => snapshot(null));
    getCollectionMock.mockImplementation(async (path: string) =>
      path === PRODUCT_COLLECTION_PATH
        // Legacy documents are keyed by the bare provider.
        ? collectionSnapshot([['meta', product]])
        : collectionSnapshot([]),
    );

    const { getMetaConnectionMerged } = await import('@/lib/platform/connections');
    const merged = await getMetaConnectionMerged('workspace_1', 'product_1');

    expect(merged?.accessTokenEncrypted).toBe('legacy-product-token');
    expect(merged?.metadata.pageId).toBe('page_1');
  });

  it('returns a specific Page when several are linked to the same brand', async () => {
    const workspace = connection({ accessTokenEncrypted: 'workspace-user-token' });
    const pageOne = connection({
      productId: 'product_1',
      metadata: { pageId: 'page_1', pageName: 'Page One' },
      createdAt: '2026-08-01T00:00:00.000Z',
    });
    const pageTwo = connection({
      productId: 'product_1',
      metadata: { pageId: 'page_2', pageName: 'Page Two' },
      createdAt: '2026-08-02T00:00:00.000Z',
    });
    getDocMock.mockImplementation((path: string) =>
      path === WORKSPACE_CREDENTIAL_PATH ? snapshot(workspace) : snapshot(null),
    );
    getCollectionMock.mockImplementation(async (path: string) =>
      path === PRODUCT_COLLECTION_PATH
        ? collectionSnapshot([['meta:page_1', pageOne], ['meta:page_2', pageTwo]])
        : collectionSnapshot([]),
    );

    const { getMetaConnectionMerged } = await import('@/lib/platform/connections');

    expect((await getMetaConnectionMerged('workspace_1', 'product_1', 'page_2'))?.metadata.pageName)
      .toBe('Page Two');
    // With no Page named, the oldest linked Page is the stable default.
    expect((await getMetaConnectionMerged('workspace_1', 'product_1'))?.metadata.pageName)
      .toBe('Page One');
  });
});
