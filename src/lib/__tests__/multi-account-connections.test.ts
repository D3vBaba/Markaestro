import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnection } from '@/lib/platform/types';

const getDocMock = vi.fn();
const getCollectionMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: (path: string) => ({ get: () => getDocMock(path) }),
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

vi.mock('@/lib/crypto', () => ({
  decrypt: (value: string) => value,
  encrypt: (value: string) => value,
}));

vi.mock('@/lib/firestore-pagination', () => ({
  getAllDocs: vi.fn().mockResolvedValue([]),
}));

const WORKSPACE_COLLECTION = 'workspaces/ws_1/platformConnections';
const PRODUCT_COLLECTION = 'workspaces/ws_1/products/prod_1/platformConnections';

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
    updatedAt: '2026-08-05T00:00:00.000Z',
    createdAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

function page(id: string, name: string, createdAt: string, status: PlatformConnection['status'] = 'connected') {
  return connection({
    status,
    productId: 'prod_1',
    createdAt,
    metadata: {
      pageId: id,
      pageName: name,
      pageAccessTokenEncrypted: `page-token-${id}`,
    },
  });
}

/** Wire the product/workspace connection collections for a test. */
function setCollections(product: Array<[string, PlatformConnection]>, workspace: Array<[string, PlatformConnection]> = []) {
  getCollectionMock.mockImplementation(async (path: string) => {
    const entries = path === PRODUCT_COLLECTION ? product : path === WORKSPACE_COLLECTION ? workspace : [];
    return { docs: entries.map(([id, data]) => ({ id, data: () => data })) };
  });
}

describe('multi-account connections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocMock.mockResolvedValue({ exists: false, data: () => null });
    setCollections([]);
  });

  it('keeps every linked Facebook Page as its own connection', async () => {
    setCollections([
      ['meta:page_a', page('page_a', 'Page A', '2026-08-01T00:00:00.000Z')],
      ['meta:page_b', page('page_b', 'Page B', '2026-08-02T00:00:00.000Z')],
      ['meta:page_c', page('page_c', 'Page C', '2026-08-03T00:00:00.000Z')],
    ]);

    const { listChannelConnections } = await import('@/lib/platform/connections');
    const conns = await listChannelConnections('ws_1', 'facebook', 'prod_1');

    expect(conns.map((conn) => conn.accountKey)).toEqual(['page_a', 'page_b', 'page_c']);
    expect(conns.map((conn) => conn.accountLabel)).toEqual(['Page A', 'Page B', 'Page C']);
  });

  it('publishes to the named Page when several are linked', async () => {
    setCollections([
      ['meta:page_a', page('page_a', 'Page A', '2026-08-01T00:00:00.000Z')],
      ['meta:page_b', page('page_b', 'Page B', '2026-08-02T00:00:00.000Z')],
    ]);

    const { getConnectionForChannel } = await import('@/lib/platform/connections');

    const chosen = await getConnectionForChannel('ws_1', 'facebook', 'prod_1', undefined, 'page_b');
    expect(chosen?.metadata.pageName).toBe('Page B');

    // With no destination named, the oldest linked Page is the stable default.
    const fallback = await getConnectionForChannel('ws_1', 'facebook', 'prod_1');
    expect(fallback?.metadata.pageName).toBe('Page A');
  });

  it('resolves the public API destination id form', async () => {
    setCollections([
      ['meta:page_a', page('page_a', 'Page A', '2026-08-01T00:00:00.000Z')],
      ['meta:page_b', page('page_b', 'Page B', '2026-08-02T00:00:00.000Z')],
    ]);

    const { getConnectionForChannel } = await import('@/lib/platform/connections');

    // Posts created through the public API store `provider:channel:accountId`.
    const chosen = await getConnectionForChannel(
      'ws_1', 'facebook', 'prod_1', undefined, 'meta:facebook:page_b',
    );
    expect(chosen?.metadata.pageName).toBe('Page B');
  });

  it('still publishes on the connected Page when the named one is gone', async () => {
    setCollections([
      ['meta:page_a', page('page_a', 'Page A', '2026-08-01T00:00:00.000Z')],
    ]);

    const { getConnectionForChannel } = await import('@/lib/platform/connections');
    const chosen = await getConnectionForChannel('ws_1', 'facebook', 'prod_1', undefined, 'page_removed');

    // A scheduled post must not fail because a destination was relinked.
    expect(chosen?.metadata.pageName).toBe('Page A');
  });

  it('falls back past a disconnected Page to a healthy one', async () => {
    setCollections([
      ['meta:page_a', page('page_a', 'Page A', '2026-08-01T00:00:00.000Z')],
      ['meta:page_b', page('page_b', 'Page B', '2026-08-02T00:00:00.000Z', 'revoked')],
    ]);

    const { getConnectionForChannel } = await import('@/lib/platform/connections');

    expect((await getConnectionForChannel('ws_1', 'facebook', 'prod_1', undefined, 'page_b'))?.metadata.pageName)
      .toBe('Page A');
    // A broken Page must not hide the healthy ones from the default path.
    expect((await getConnectionForChannel('ws_1', 'facebook', 'prod_1'))?.metadata.pageName).toBe('Page A');
  });

  it('returns nothing when the brand has no connected account at all', async () => {
    setCollections([
      ['meta:page_a', page('page_a', 'Page A', '2026-08-01T00:00:00.000Z', 'revoked')],
    ]);

    const { getConnectionForChannel } = await import('@/lib/platform/connections');
    expect(await getConnectionForChannel('ws_1', 'facebook', 'prod_1', undefined, 'page_a')).toBeNull();
  });

  it('links two Instagram accounts to one brand without either displacing the other', async () => {
    const account = (id: string, username: string, createdAt: string) => connection({
      provider: 'instagram',
      channels: ['instagram'],
      productId: 'prod_1',
      createdAt,
      metadata: { igAccountId: id, username },
    });

    setCollections([
      ['instagram:ig_1', account('ig_1', 'brand_main', '2026-08-01T00:00:00.000Z')],
      ['instagram:ig_2', account('ig_2', 'brand_alt', '2026-08-02T00:00:00.000Z')],
    ]);

    const { listChannelConnections, getConnectionForChannel } = await import('@/lib/platform/connections');

    expect((await listChannelConnections('ws_1', 'instagram', 'prod_1'))).toHaveLength(2);
    expect((await getConnectionForChannel('ws_1', 'instagram', 'prod_1', undefined, 'ig_2'))?.metadata.username)
      .toBe('brand_alt');
  });

  it('collapses a legacy provider-keyed record into its account-scoped twin', async () => {
    // Same Page, stored under both the old and new document ids.
    setCollections([
      ['meta', page('page_a', 'Page A', '2026-07-01T00:00:00.000Z')],
      ['meta:page_a', page('page_a', 'Page A', '2026-07-01T00:00:00.000Z')],
    ]);

    const { listConnections } = await import('@/lib/platform/connections');
    const conns = await listConnections('ws_1', 'prod_1');

    expect(conns).toHaveLength(1);
    expect(conns[0].connectionId).toBe('meta:page_a');
  });

  it('hides the pending record once a real destination is linked', async () => {
    setCollections([
      // Authorized but no board chosen yet.
      ['pinterest', connection({
        provider: 'pinterest',
        channels: ['pinterest'],
        productId: 'prod_1',
        metadata: { boardSelectionRequired: true },
      })],
      ['pinterest:board_1', connection({
        provider: 'pinterest',
        channels: ['pinterest'],
        productId: 'prod_1',
        metadata: { boardId: 'board_1', boardName: 'Ideas' },
      })],
    ]);

    const { listProviderConnections } = await import('@/lib/platform/connections');
    const conns = await listProviderConnections('ws_1', 'pinterest', 'prod_1');

    expect(conns.map((conn) => conn.accountKey)).toEqual(['board_1']);
  });

  it('keeps both logins reachable when two Pinterest accounts are connected', async () => {
    const boardOf = (credential: string, boardId: string, createdAt: string) => connection({
      provider: 'pinterest',
      channels: ['pinterest'],
      productId: 'prod_1',
      createdAt,
      accessTokenEncrypted: `token-${credential}`,
      metadata: { pinterestUserId: credential, boardId, boardName: `Board ${boardId}` },
    });

    setCollections([
      // Account one linked a board, then account two logged in and replaced the
      // pending grant document.
      ['pinterest:board_1', boardOf('acct_1', 'board_1', '2026-08-01T00:00:00.000Z')],
      ['pinterest:acct_2', connection({
        provider: 'pinterest',
        channels: ['pinterest'],
        productId: 'prod_1',
        createdAt: '2026-08-02T00:00:00.000Z',
        accessTokenEncrypted: 'token-acct_2',
        metadata: { pinterestUserId: 'acct_2', boardSelectionRequired: true },
      })],
    ]);

    const { listProviderCredentials } = await import('@/lib/platform/connections');
    const credentials = await listProviderCredentials('ws_1', 'pinterest', 'prod_1');

    // Account one survives through the board it already linked, so its other
    // boards remain listable.
    expect(credentials.map((conn) => conn.credentialKey)).toEqual(['acct_1', 'acct_2']);
    expect(credentials.map((conn) => conn.accessTokenEncrypted)).toEqual(['token-acct_1', 'token-acct_2']);
  });

  it('does not collapse two pending grants from different accounts', async () => {
    const pending = (credential: string, createdAt: string) => connection({
      provider: 'linkedin_community',
      channels: ['linkedin'],
      productId: 'prod_1',
      createdAt,
      metadata: { linkedinAuthorizingProfileId: credential },
    });

    setCollections([
      ['linkedin_community:member_1', pending('member_1', '2026-08-01T00:00:00.000Z')],
      ['linkedin_community:member_2', pending('member_2', '2026-08-02T00:00:00.000Z')],
    ]);

    const { listConnections, listProviderCredentials } = await import('@/lib/platform/connections');

    expect(await listConnections('ws_1', 'prod_1')).toHaveLength(2);
    expect((await listProviderCredentials('ws_1', 'linkedin_community', 'prod_1')).map((c) => c.credentialKey))
      .toEqual(['member_1', 'member_2']);
  });

  it('prefers the pending grant over a destination copy for the same account', async () => {
    setCollections([
      ['pinterest:board_1', connection({
        provider: 'pinterest',
        channels: ['pinterest'],
        productId: 'prod_1',
        accessTokenEncrypted: 'stale-copy',
        createdAt: '2026-08-01T00:00:00.000Z',
        metadata: { pinterestUserId: 'acct_1', boardId: 'board_1' },
      })],
      ['pinterest:acct_1', connection({
        provider: 'pinterest',
        channels: ['pinterest'],
        productId: 'prod_1',
        accessTokenEncrypted: 'fresh-grant',
        createdAt: '2026-08-01T00:00:00.000Z',
        metadata: { pinterestUserId: 'acct_1' },
      })],
    ]);

    const { listProviderCredentials } = await import('@/lib/platform/connections');
    const credentials = await listProviderCredentials('ws_1', 'pinterest', 'prod_1');

    expect(credentials).toHaveLength(1);
    expect(credentials[0].accessTokenEncrypted).toBe('fresh-grant');
  });

  it('still reads a legacy single-slot connection that was never migrated', async () => {
    setCollections([
      ['threads', connection({
        provider: 'threads',
        channels: ['threads'],
        productId: 'prod_1',
        metadata: { threadsUserId: 'th_1', username: 'brand' },
      })],
    ]);

    const { getConnectionForChannel } = await import('@/lib/platform/connections');
    const conn = await getConnectionForChannel('ws_1', 'threads', 'prod_1');

    expect(conn?.accountKey).toBe('th_1');
    expect(conn?.connectionId).toBe('threads');
  });
});
