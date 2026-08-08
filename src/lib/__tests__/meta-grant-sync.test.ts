import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnection } from '@/lib/platform/types';
import type { MetaManagedPage } from '@/lib/meta-pages';

const batchUpdate = vi.fn();
const batchCommit = vi.fn().mockResolvedValue(undefined);
const productsGet = vi.fn();
const listProviderConnectionsMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: () => ({ get: productsGet }),
    batch: () => ({ update: batchUpdate, commit: batchCommit }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => '__deleted__' },
}));

vi.mock('@/lib/crypto', () => ({
  encrypt: (value: string) => `enc(${value})`,
}));

vi.mock('@/lib/platform/connections', () => ({
  getConnectionRef: vi.fn(),
  listProviderConnections: listProviderConnectionsMock,
  refForConnection: (conn: PlatformConnection) => ({ id: conn.connectionId, path: conn.connectionId }),
}));

function pageConnection(pageId: string, storedPageToken = 'enc(page-token)'): PlatformConnection {
  return {
    provider: 'meta',
    connectionId: `meta:${pageId}`,
    accountKey: pageId,
    channels: ['facebook'],
    capabilities: [],
    status: 'connected',
    accessTokenEncrypted: 'enc(token)',
    metadata: {
      pageId,
      pageName: `Page ${pageId}`,
      ...(storedPageToken ? { pageAccessTokenEncrypted: storedPageToken } : {}),
    },
    workspaceId: 'ws_1',
    productId: 'prod_1',
    updatedBy: 'user_1',
    updatedAt: '2026-08-08T00:00:00.000Z',
    createdAt: '2026-08-08T00:00:00.000Z',
  };
}

function grantedPage(id: string, accessToken: string | null): MetaManagedPage {
  return { id, name: `Page ${id}`, accessToken };
}

const input = {
  workspaceId: 'ws_1',
  userId: 'user_1',
  userAccessToken: 'user-token',
};

describe('syncGrantedMetaProductConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    batchCommit.mockResolvedValue(undefined);
    // Two brands, each with its own linked Page.
    productsGet.mockResolvedValue({ docs: [{ id: 'prod_1' }, { id: 'prod_2' }] });
    listProviderConnectionsMock.mockImplementation(async (_ws, _provider, productId) =>
      productId === 'prod_1' ? [pageConnection('page_a')] : [pageConnection('page_b')],
    );
  });

  it('never revokes another brand when the grant was read incompletely', async () => {
    const { syncGrantedMetaProductConnections } = await import('@/lib/oauth/meta-connection-sync');

    // Only page_a came back — a truncated or partially failed read.
    const result = await syncGrantedMetaProductConnections({
      ...input,
      pages: [grantedPage('page_a', 'page-a-token')],
      grantIsComplete: false,
    });

    expect(result.revokedProductIds).toEqual([]);
    expect(result.syncedProductIds).toEqual(['prod_1']);
    const revokes = batchUpdate.mock.calls.filter(([, update]) => update.status === 'revoked');
    expect(revokes).toHaveLength(0);
  });

  it('revokes a Page only once the full grant confirms it is gone', async () => {
    const { syncGrantedMetaProductConnections } = await import('@/lib/oauth/meta-connection-sync');

    const result = await syncGrantedMetaProductConnections({
      ...input,
      pages: [grantedPage('page_a', 'page-a-token')],
      grantIsComplete: true,
    });

    expect(result.syncedProductIds).toEqual(['prod_1']);
    expect(result.revokedProductIds).toEqual(['prod_2']);
  });

  it('keeps a granted Page connected when the response carried no Page token', async () => {
    const { syncGrantedMetaProductConnections } = await import('@/lib/oauth/meta-connection-sync');

    const result = await syncGrantedMetaProductConnections({
      ...input,
      // Both granted, but Meta returned no access_token for page_b.
      pages: [grantedPage('page_a', 'page-a-token'), grantedPage('page_b', null)],
      grantIsComplete: true,
    });

    expect(result.revokedProductIds).toEqual([]);
    expect(result.syncedProductIds).toEqual(['prod_1', 'prod_2']);

    // The stored Page token must be left untouched, not deleted or overwritten.
    const pageBUpdate = batchUpdate.mock.calls.find(([ref]) => ref.id === 'meta:page_b')?.[1];
    expect(pageBUpdate.status).toBe('connected');
    expect(pageBUpdate).not.toHaveProperty('metadata.pageAccessTokenEncrypted');
  });

  it('asks for a re-pick, not a reconnect, when a granted Page has no usable token', async () => {
    // Previously revoked: its stored Page token was deleted.
    listProviderConnectionsMock.mockImplementation(async (_ws, _provider, productId) =>
      productId === 'prod_1' ? [pageConnection('page_a')] : [pageConnection('page_b', '')],
    );

    const { syncGrantedMetaProductConnections } = await import('@/lib/oauth/meta-connection-sync');
    const result = await syncGrantedMetaProductConnections({
      ...input,
      pages: [grantedPage('page_a', 'page-a-token'), grantedPage('page_b', null)],
      grantIsComplete: true,
    });

    expect(result.revokedProductIds).toEqual([]);
    expect(result.syncedProductIds).toEqual(['prod_1']);

    const pageBUpdate = batchUpdate.mock.calls.find(([ref]) => ref.id === 'meta:page_b')?.[1];
    expect(pageBUpdate.status).toBe('error');
    expect(pageBUpdate['metadata.pageSelectionRequired']).toBe(true);
    expect(pageBUpdate['metadata.lastRefreshError']).toMatch(/Pick it again/);
  });

  it('restores a Page that a previous partial read had revoked', async () => {
    listProviderConnectionsMock.mockImplementation(async (_ws, _provider, productId) => {
      const conn = pageConnection(productId === 'prod_1' ? 'page_a' : 'page_b', '');
      return [{
        ...conn,
        status: 'revoked' as const,
        metadata: {
          ...conn.metadata,
          lastRefreshError: 'This Facebook Page is not included in the current Markaestro Page permissions.',
        },
      }];
    });

    const { syncGrantedMetaProductConnections } = await import('@/lib/oauth/meta-connection-sync');
    const result = await syncGrantedMetaProductConnections({
      ...input,
      pages: [grantedPage('page_a', 'page-a-token'), grantedPage('page_b', 'page-b-token')],
      grantIsComplete: true,
    });

    expect(result.revokedProductIds).toEqual([]);
    expect(result.syncedProductIds).toEqual(['prod_1', 'prod_2']);
    for (const [, update] of batchUpdate.mock.calls) {
      expect(update.status).toBe('connected');
      expect(update['metadata.lastRefreshError']).toBeNull();
    }
  });
});
