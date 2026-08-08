import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnection } from '@/lib/platform/types';

const requireContextMock = vi.fn();
const getAdapterForChannelMock = vi.fn();
const getConnectionForChannelMock = vi.fn();
const getLinkedInConnectionForDestinationMock = vi.fn();
const refreshConnectionTokenMock = vi.fn();
const firestoreGetMock = vi.fn();
const firestoreUpdateMock = vi.fn();

vi.mock('@/lib/server-auth', () => ({
  requireContext: requireContextMock,
}));

vi.mock('@/lib/platform/registry', () => ({
  getAdapterForChannel: getAdapterForChannelMock,
}));

vi.mock('@/lib/platform/connections', () => ({
  getConnectionForChannel: getConnectionForChannelMock,
  getLinkedInConnectionForDestination: getLinkedInConnectionForDestinationMock,
}));

vi.mock('@/lib/oauth/token-refresh', () => ({
  refreshConnectionToken: refreshConnectionTokenMock,
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: () => ({
      where: () => ({
        limit: () => ({ get: firestoreGetMock }),
      }),
    }),
  },
}));

const ctx = {
  uid: 'user_1',
  email: 'user@example.com',
  workspaceId: 'ws_1',
  role: 'admin' as const,
  emailVerified: true,
};

function makeConnection(overrides: Partial<PlatformConnection> = {}): PlatformConnection {
  return {
    provider: 'meta',
    channels: ['facebook'],
    capabilities: [],
    status: 'connected',
    accessTokenEncrypted: 'enc',
    metadata: {},
    workspaceId: 'ws_1',
    productId: 'prod_1',
    updatedBy: 'user_1',
    updatedAt: '2026-06-21T00:00:00.000Z',
    createdAt: '2026-06-21T00:00:00.000Z',
    ...overrides,
  } as PlatformConnection;
}

const samplePost = {
  externalId: 'post_1',
  channel: 'facebook',
  content: 'Hello',
  mediaType: 'text',
  mediaUrl: null,
  thumbnailUrl: null,
  permalink: 'https://facebook.com/post_1',
  publishedAt: '2026-06-01T00:00:00.000Z',
  canDelete: true,
};

function listRequest(params: Record<string, string>) {
  const qs = new URLSearchParams({ workspaceId: 'ws_1', ...params });
  return new Request(`http://localhost/api/social/posts?${qs.toString()}`);
}

function deleteRequest(params: Record<string, string>) {
  const qs = new URLSearchParams({ workspaceId: 'ws_1', ...params });
  return new Request(`http://localhost/api/social/posts?${qs.toString()}`, { method: 'DELETE' });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireContextMock.mockResolvedValue(ctx);
  firestoreGetMock.mockResolvedValue({ docs: [] });
});

describe('GET /api/social/posts', () => {
  it('returns platform posts for a connected channel', async () => {
    const listPosts = vi.fn().mockResolvedValue({ ok: true, posts: [samplePost], nextCursor: 'cur_2' });
    getAdapterForChannelMock.mockReturnValue({ listPosts });
    getConnectionForChannelMock.mockResolvedValue(makeConnection());

    const { GET } = await import('./route');
    const res = await GET(listRequest({ channel: 'facebook', productId: 'prod_1', limit: '10' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.posts).toEqual([samplePost]);
    expect(body.nextCursor).toBe('cur_2');
    expect(getConnectionForChannelMock).toHaveBeenCalledWith('ws_1', 'facebook', 'prod_1', undefined, undefined);
    expect(listPosts).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      channel: 'facebook',
      limit: 10,
    }));
  });

  it('resolves LinkedIn connections through the destination-aware resolver', async () => {
    const listPosts = vi.fn().mockResolvedValue({ ok: true, posts: [] });
    getAdapterForChannelMock.mockReturnValue({ listPosts });
    getLinkedInConnectionForDestinationMock.mockResolvedValue(makeConnection({ provider: 'linkedin_profile' }));

    const { GET } = await import('./route');
    const res = await GET(listRequest({ channel: 'linkedin', destinationId: 'dest_1' }));

    expect(res.status).toBe(200);
    expect(getLinkedInConnectionForDestinationMock).toHaveBeenCalledWith('ws_1', undefined, 'dest_1');
    expect(getConnectionForChannelMock).not.toHaveBeenCalled();
  });

  it('returns 400 NOT_CONNECTED when no connection exists', async () => {
    getAdapterForChannelMock.mockReturnValue({ listPosts: vi.fn() });
    getConnectionForChannelMock.mockResolvedValue(null);

    const { GET } = await import('./route');
    const res = await GET(listRequest({ channel: 'facebook' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('NOT_CONNECTED');
  });

  it('retries once with a refreshed connection on auth failure', async () => {
    const listPosts = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'token expired', reason: 'auth' })
      .mockResolvedValueOnce({ ok: true, posts: [samplePost] });
    getAdapterForChannelMock.mockReturnValue({ listPosts });
    const stale = makeConnection({ provider: 'tiktok', refreshTokenEncrypted: 'refresh_enc' });
    const fresh = makeConnection({ provider: 'tiktok', accessTokenEncrypted: 'fresh_enc' });
    getConnectionForChannelMock.mockResolvedValue(stale);
    refreshConnectionTokenMock.mockResolvedValue(fresh);

    const { GET } = await import('./route');
    const res = await GET(listRequest({ channel: 'tiktok', productId: 'prod_1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.posts).toEqual([samplePost]);
    expect(refreshConnectionTokenMock).toHaveBeenCalledWith('ws_1', 'tiktok', stale, 'prod_1');
    expect(listPosts).toHaveBeenCalledTimes(2);
    expect(listPosts.mock.calls[1][0]).toBe(fresh);
  });

  it('maps a persistent auth failure to 409 with a reconnect hint', async () => {
    const listPosts = vi.fn().mockResolvedValue({ ok: false, error: 'token expired', reason: 'auth' });
    getAdapterForChannelMock.mockReturnValue({ listPosts });
    // No refresh token → no retry possible.
    getConnectionForChannelMock.mockResolvedValue(makeConnection());

    const { GET } = await import('./route');
    const res = await GET(listRequest({ channel: 'facebook' }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('CONNECTION_AUTH_ERROR');
    expect(body.message).toContain('reconnect');
    expect(refreshConnectionTokenMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid channel with 400', async () => {
    const { GET } = await import('./route');
    const res = await GET(listRequest({ channel: 'myspace' }));
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    requireContextMock.mockRejectedValue(new Error('UNAUTHENTICATED'));
    const { GET } = await import('./route');
    const res = await GET(listRequest({ channel: 'facebook' }));
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/social/posts', () => {
  it('deletes the platform post and reconciles matching app posts', async () => {
    const deletePost = vi.fn().mockResolvedValue({ ok: true });
    getAdapterForChannelMock.mockReturnValue({ deletePost });
    getConnectionForChannelMock.mockResolvedValue(makeConnection());
    firestoreGetMock.mockResolvedValue({ docs: [{ ref: { update: firestoreUpdateMock } }] });

    const { DELETE } = await import('./route');
    const res = await DELETE(deleteRequest({ channel: 'facebook', externalId: 'post_1', productId: 'prod_1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, channel: 'facebook', externalId: 'post_1' });
    expect(deletePost).toHaveBeenCalledWith(expect.anything(), {
      channel: 'facebook',
      externalId: 'post_1',
      destinationId: undefined,
    });
    expect(firestoreUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      platformDeletedAt: expect.any(String),
      updatedBy: 'user_1',
    }));
  });

  it('forbids analysts (no posts.write) with 403', async () => {
    requireContextMock.mockResolvedValue({ ...ctx, role: 'analyst' });
    const deletePost = vi.fn();
    getAdapterForChannelMock.mockReturnValue({ deletePost });

    const { DELETE } = await import('./route');
    const res = await DELETE(deleteRequest({ channel: 'facebook', externalId: 'post_1' }));

    expect(res.status).toBe(403);
    expect(deletePost).not.toHaveBeenCalled();
  });

  it('maps adapter not_found to 404', async () => {
    getAdapterForChannelMock.mockReturnValue({
      deletePost: vi.fn().mockResolvedValue({ ok: false, error: 'Post not found', reason: 'not_found' }),
    });
    getConnectionForChannelMock.mockResolvedValue(makeConnection());

    const { DELETE } = await import('./route');
    const res = await DELETE(deleteRequest({ channel: 'facebook', externalId: 'gone' }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('PLATFORM_POST_NOT_FOUND');
    expect(firestoreUpdateMock).not.toHaveBeenCalled();
  });

  it('maps unsupported deletes (e.g. TikTok) to 400', async () => {
    getAdapterForChannelMock.mockReturnValue({
      deletePost: vi.fn().mockResolvedValue({
        ok: false,
        error: 'TikTok does not allow apps to delete videos.',
        reason: 'unsupported',
      }),
    });
    getConnectionForChannelMock.mockResolvedValue(makeConnection({ provider: 'tiktok' }));

    const { DELETE } = await import('./route');
    const res = await DELETE(deleteRequest({ channel: 'tiktok', externalId: '741' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('UNSUPPORTED');
  });

  it('requires externalId', async () => {
    getAdapterForChannelMock.mockReturnValue({ deletePost: vi.fn() });
    const { DELETE } = await import('./route');
    const res = await DELETE(deleteRequest({ channel: 'facebook' }));
    expect(res.status).toBe(400);
  });

  it('still succeeds when reconciliation fails', async () => {
    getAdapterForChannelMock.mockReturnValue({
      deletePost: vi.fn().mockResolvedValue({ ok: true }),
    });
    getConnectionForChannelMock.mockResolvedValue(makeConnection());
    firestoreGetMock.mockRejectedValue(new Error('firestore down'));

    const { DELETE } = await import('./route');
    const res = await DELETE(deleteRequest({ channel: 'facebook', externalId: 'post_1' }));

    expect(res.status).toBe(200);
  });
});
