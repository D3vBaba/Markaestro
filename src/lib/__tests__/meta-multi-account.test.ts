import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnection } from '@/lib/platform/types';

const getDocMock = vi.fn();
const getCollectionMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: (path: string) => ({ get: () => getDocMock(path) }),
    collection: (path: string) => ({
      doc: (id: string) => ({ id, path: `${path}/${id}`, get: () => getDocMock(`${path}/${id}`) }),
      get: () => getCollectionMock(path),
    }),
  },
}));

vi.mock('@/lib/crypto', () => ({
  decrypt: (value: string) => value,
  encrypt: (value: string) => value,
}));

vi.mock('@/lib/firestore-pagination', () => ({
  getAllDocs: vi.fn().mockResolvedValue([]),
}));

const WORKSPACE = 'workspaces/ws_1/platformConnections';
const PRODUCT = 'workspaces/ws_1/products/prod_1/platformConnections';

function connection(overrides: Partial<PlatformConnection> = {}): PlatformConnection {
  return {
    provider: 'meta',
    channels: ['facebook'],
    capabilities: [],
    status: 'connected',
    accessTokenEncrypted: 'token',
    metadata: {},
    workspaceId: 'ws_1',
    updatedBy: 'user_1',
    updatedAt: '2026-08-08T00:00:00.000Z',
    createdAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  };
}

/** A connected Facebook account's workspace credential. */
function credential(metaUserId: string, createdAt: string) {
  return connection({
    createdAt,
    accessTokenEncrypted: `user-token-${metaUserId}`,
    metadata: { metaUserId, availablePages: [] },
  });
}

/** A Page linked to a brand, owned by one of those accounts. */
function pageConnection(pageId: string, metaUserId: string | null, createdAt: string) {
  return connection({
    productId: 'prod_1',
    createdAt,
    accessTokenEncrypted: 'stale-copied-user-token',
    ...(metaUserId ? { credentialKey: metaUserId } : {}),
    metadata: {
      pageId,
      pageName: `Page ${pageId}`,
      pageAccessTokenEncrypted: `page-token-${pageId}`,
    },
  });
}

function setCollections(
  workspace: Array<[string, PlatformConnection]>,
  product: Array<[string, PlatformConnection]> = [],
) {
  getCollectionMock.mockImplementation(async (path: string) => {
    const entries = path === WORKSPACE ? workspace : path === PRODUCT ? product : [];
    return { docs: entries.map(([id, data]) => ({ id, data: () => data })) };
  });
}

describe('two connected Meta accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocMock.mockResolvedValue({ exists: false, data: () => null });
    setCollections([]);
  });

  it('keeps both Facebook accounts as separate credentials', async () => {
    setCollections([
      ['meta:acct_1', credential('acct_1', '2026-08-01T00:00:00.000Z')],
      ['meta:acct_2', credential('acct_2', '2026-08-02T00:00:00.000Z')],
    ]);

    const { listWorkspaceCredentials } = await import('@/lib/platform/connections');
    const credentials = await listWorkspaceCredentials('ws_1', 'meta');

    expect(credentials.map((conn) => conn.credentialKey)).toEqual(['acct_1', 'acct_2']);
  });

  it('never hands one account\'s user token to the other account\'s Page', async () => {
    setCollections(
      [
        ['meta:acct_1', credential('acct_1', '2026-08-01T00:00:00.000Z')],
        ['meta:acct_2', credential('acct_2', '2026-08-02T00:00:00.000Z')],
      ],
      [
        ['meta:page_a', pageConnection('page_a', 'acct_1', '2026-08-03T00:00:00.000Z')],
        ['meta:page_b', pageConnection('page_b', 'acct_2', '2026-08-04T00:00:00.000Z')],
      ],
    );

    const { listChannelConnections } = await import('@/lib/platform/connections');
    const conns = await listChannelConnections('ws_1', 'facebook', 'prod_1');

    const byPage = new Map(conns.map((conn) => [conn.metadata.pageId, conn]));
    expect(byPage.get('page_a')?.accessTokenEncrypted).toBe('user-token-acct_1');
    expect(byPage.get('page_b')?.accessTokenEncrypted).toBe('user-token-acct_2');
    // The owning account's identity must not bleed across either.
    expect(byPage.get('page_a')?.metadata.metaUserId).toBe('acct_1');
    expect(byPage.get('page_b')?.metadata.metaUserId).toBe('acct_2');
  });

  it('leaves an unowned legacy Page on its own tokens when two accounts exist', async () => {
    setCollections(
      [
        ['meta:acct_1', credential('acct_1', '2026-08-01T00:00:00.000Z')],
        ['meta:acct_2', credential('acct_2', '2026-08-02T00:00:00.000Z')],
      ],
      // Linked before Pages recorded their owning account.
      [['meta:page_legacy', pageConnection('page_legacy', null, '2026-07-01T00:00:00.000Z')]],
    );

    const { listChannelConnections } = await import('@/lib/platform/connections');
    const [conn] = await listChannelConnections('ws_1', 'facebook', 'prod_1');

    // Guessing an owner could attach the wrong account, so it keeps its own.
    expect(conn.accessTokenEncrypted).toBe('stale-copied-user-token');
    expect(conn.metadata.metaUserId).toBeUndefined();
  });

  it('still adopts the sole credential for a legacy Page when one account exists', async () => {
    setCollections(
      [['meta', credential('acct_1', '2026-08-01T00:00:00.000Z')]],
      [['meta:page_legacy', pageConnection('page_legacy', null, '2026-07-01T00:00:00.000Z')]],
    );

    const { listChannelConnections } = await import('@/lib/platform/connections');
    const [conn] = await listChannelConnections('ws_1', 'facebook', 'prod_1');

    expect(conn.accessTokenEncrypted).toBe('user-token-acct_1');
  });

  it('resolves a specific account credential by id', async () => {
    setCollections([
      ['meta:acct_1', credential('acct_1', '2026-08-01T00:00:00.000Z')],
      ['meta:acct_2', credential('acct_2', '2026-08-02T00:00:00.000Z')],
    ]);

    const { getWorkspaceCredential } = await import('@/lib/platform/connections');

    expect((await getWorkspaceCredential('ws_1', 'meta', 'acct_2'))?.accessTokenEncrypted)
      .toBe('user-token-acct_2');
    expect(await getWorkspaceCredential('ws_1', 'meta', 'missing')).toBeNull();
  });
});
