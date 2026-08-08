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

function updateFor(connectionId: string) {
  return batchUpdate.mock.calls.find(([ref]) => ref.id === connectionId)?.[1];
}

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

  it('flags a Page the grant no longer covers with an actionable message', async () => {
    const { syncGrantedMetaProductConnections } = await import('@/lib/oauth/meta-connection-sync');

    // Facebook's asset dialog granted only page_a. page_b's stored token is
    // dead from this moment, so saying "connected" would be a lie.
    const result = await syncGrantedMetaProductConnections({
      ...input,
      pages: [grantedPage('page_a', 'page-a-token')],
      grantIsComplete: true,
    });

    expect(result.syncedProductIds).toEqual(['prod_1']);
    expect(result.ungrantedProductIds).toEqual(['prod_2']);

    const pageB = updateFor('meta:page_b');
    expect(pageB.status).toBe('error');
    expect(pageB['metadata.lastRefreshError']).toMatch(/tick this Page/);
    // Nothing is deleted — reconnecting and ticking the Page restores it.
    expect(pageB['metadata.pageAccessTokenEncrypted']).toBeUndefined();
  });

  it('leaves every brand alone when the grant was read incompletely', async () => {
    const { syncGrantedMetaProductConnections } = await import('@/lib/oauth/meta-connection-sync');

    // A truncated or partially failed read is not evidence of anything.
    const result = await syncGrantedMetaProductConnections({
      ...input,
      pages: [],
      grantIsComplete: false,
    });

    expect(result.ungrantedProductIds).toEqual([]);
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('keeps a granted Page connected when the response carried no Page token', async () => {
    const { syncGrantedMetaProductConnections } = await import('@/lib/oauth/meta-connection-sync');

    const result = await syncGrantedMetaProductConnections({
      ...input,
      // Both granted, but Meta returned no access_token for page_b.
      pages: [grantedPage('page_a', 'page-a-token'), grantedPage('page_b', null)],
      grantIsComplete: true,
    });

    expect(result.syncedProductIds).toEqual(['prod_1', 'prod_2']);
    expect(result.ungrantedProductIds).toEqual([]);

    // The stored Page token must be left untouched, not deleted or overwritten.
    const pageB = updateFor('meta:page_b');
    expect(pageB.status).toBe('connected');
    expect(pageB).not.toHaveProperty('metadata.pageAccessTokenEncrypted');
  });

  it('asks for a re-pick when a granted Page has no usable token at all', async () => {
    listProviderConnectionsMock.mockImplementation(async (_ws, _provider, productId) =>
      productId === 'prod_1' ? [pageConnection('page_a')] : [pageConnection('page_b', '')],
    );

    const { syncGrantedMetaProductConnections } = await import('@/lib/oauth/meta-connection-sync');
    const result = await syncGrantedMetaProductConnections({
      ...input,
      pages: [grantedPage('page_a', 'page-a-token'), grantedPage('page_b', null)],
      grantIsComplete: true,
    });

    expect(result.syncedProductIds).toEqual(['prod_1']);
    const pageB = updateFor('meta:page_b');
    expect(pageB.status).toBe('error');
    expect(pageB['metadata.pageSelectionRequired']).toBe(true);
    expect(pageB['metadata.lastRefreshError']).toMatch(/Pick it again/);
  });

  it('restores a Page that an earlier build had wrongly revoked', async () => {
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

    expect(result.syncedProductIds).toEqual(['prod_1', 'prod_2']);
    for (const [, update] of batchUpdate.mock.calls) {
      expect(update.status).toBe('connected');
      expect(update['metadata.lastRefreshError']).toBeNull();
    }
  });

  it('does not overwrite the cached Page list from a partial read', async () => {
    const { syncGrantedMetaProductConnections } = await import('@/lib/oauth/meta-connection-sync');

    await syncGrantedMetaProductConnections({
      ...input,
      pages: [grantedPage('page_a', 'page-a-token')],
      grantIsComplete: false,
    });

    expect(updateFor('meta:page_a')).not.toHaveProperty('metadata.availablePages');
  });
});
