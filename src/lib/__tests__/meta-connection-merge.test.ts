import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnection } from '@/lib/platform/types';

const getDocMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: (path: string) => ({
      get: () => getDocMock(path),
    }),
  },
}));

function snapshot(connection: PlatformConnection | null) {
  return {
    exists: Boolean(connection),
    data: () => connection,
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

describe('getMetaConnectionMerged', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      path === 'workspaces/workspace_1/platformConnections/meta'
        ? snapshot(workspace)
        : snapshot(product),
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
      path === 'workspaces/workspace_1/platformConnections/meta'
        ? snapshot(workspace)
        : snapshot(product),
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
    getDocMock.mockImplementation((path: string) =>
      path === 'workspaces/workspace_1/platformConnections/meta'
        ? snapshot(null)
        : snapshot(product),
    );

    const { getMetaConnectionMerged } = await import('@/lib/platform/connections');
    const merged = await getMetaConnectionMerged('workspace_1', 'product_1');

    expect(merged?.accessTokenEncrypted).toBe('legacy-product-token');
    expect(merged?.metadata.pageId).toBe('page_1');
  });
});
