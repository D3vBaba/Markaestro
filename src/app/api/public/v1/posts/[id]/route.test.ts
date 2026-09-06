import { beforeEach, describe, expect, it, vi } from 'vitest';

const requirePublicApiContextMock = vi.fn();
const deletePlatformPostMock = vi.fn();
const docs = new Map<string, { data?: Record<string, unknown>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }>();

vi.mock('@/lib/public-api/auth', () => ({
  requirePublicApiContext: requirePublicApiContextMock,
  hasPublicApiScope: (scopes: string[], scope: string) => scopes.includes(scope),
}));
vi.mock('@/lib/public-api/idempotency', () => ({
  getIdempotencyKey: () => null,
  createRequestHash: () => 'hash',
  loadIdempotentResponse: vi.fn(),
  persistIdempotentResponse: vi.fn(),
}));
vi.mock('@/lib/social/platform-post-delete', () => ({
  deletePlatformPost: deletePlatformPostMock,
}));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: (path: string) => {
      const entry = docs.get(path) ?? { update: vi.fn(), delete: vi.fn() };
      docs.set(path, entry);
      return {
        get: async () => ({ exists: entry.data !== undefined, data: () => entry.data }),
        update: entry.update,
        delete: entry.delete,
      };
    },
  },
}));

function seed(path: string, data: Record<string, unknown> | undefined) {
  const entry = { data, update: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };
  docs.set(path, entry);
  return entry;
}

function context(scopes: string[], productId: string | null = 'prod_1') {
  return {
    principalType: 'api_client',
    workspaceId: 'ws_1',
    clientId: 'cli_1',
    productId,
    scopes,
    planTier: 'pro',
    rateLimitHeaders: { 'X-RateLimit-Limit': '30' },
  };
}

function call(id: string, query = '') {
  return import('./route').then(({ DELETE }) => DELETE(
    new Request(`http://localhost/api/public/v1/posts/${id}${query}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id }) },
  ));
}

const POSTS = 'workspaces/ws_1/posts';
const SOCIAL = 'workspaces/ws_1/socialPosts';

describe('DELETE /api/public/v1/posts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docs.clear();
    requirePublicApiContextMock.mockResolvedValue(context(['posts.write', 'posts.publish']));
    deletePlatformPostMock.mockResolvedValue({ ok: true, connection: {} });
  });

  it('takes a post published directly on the platform down and stops tracking it', async () => {
    seed(`${POSTS}/native_9`, undefined);
    const native = seed(`${SOCIAL}/native_9`, {
      provenance: 'platform_native', platform: 'facebook', externalId: 'fb_9', productId: 'prod_1',
      provider: 'meta', accountKey: 'page_1', publishedAt: '2026-08-01T10:00:00.000Z',
    });

    const response = await call('native_9');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, id: 'native_9', source: 'native', platform: { channels: ['facebook'], skipped: [] } });
    expect(deletePlatformPostMock).toHaveBeenCalledWith('ws_1', {
      channel: 'facebook', externalId: 'fb_9', productId: 'prod_1', destinationId: 'page_1',
    });
    expect(native.update).toHaveBeenCalledWith(expect.objectContaining({ deletedAt: expect.any(String), metricsStatus: 'unsupported' }));
    expect(native.delete).not.toHaveBeenCalled();
  });

  it('refuses a native post on a platform that offers no delete, before any platform call', async () => {
    seed(`${POSTS}/native_tt`, undefined);
    const native = seed(`${SOCIAL}/native_tt`, { provenance: 'platform_native', platform: 'tiktok', externalId: 'tt_1', productId: 'prod_1' });

    const response = await call('native_tt');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ error: 'UNSUPPORTED', channel: 'tiktok' }));
    expect(deletePlatformPostMock).not.toHaveBeenCalled();
    expect(native.update).not.toHaveBeenCalled();
  });

  it('answers 404 for a native post in another brand, and never touches the platform', async () => {
    seed(`${POSTS}/native_9`, undefined);
    seed(`${SOCIAL}/native_9`, { provenance: 'platform_native', platform: 'facebook', externalId: 'fb_9', productId: 'prod_other' });

    const response = await call('native_9');

    expect(response.status).toBe(404);
    expect(deletePlatformPostMock).not.toHaveBeenCalled();
  });

  it('refuses to take a live post down without posts.publish', async () => {
    requirePublicApiContextMock.mockResolvedValue(context(['posts.write']));
    seed(`${POSTS}/native_9`, undefined);
    seed(`${SOCIAL}/native_9`, { provenance: 'platform_native', platform: 'facebook', externalId: 'fb_9', productId: 'prod_1' });

    const response = await call('native_9');

    expect(response.status).toBe(403);
    expect((await response.json()).requiredScope).toBe('posts.publish');
    expect(deletePlatformPostMock).not.toHaveBeenCalled();
  });

  it('removes only the record of a published post unless platform=true is asked for', async () => {
    const post = seed(`${POSTS}/pst_1`, {
      status: 'published', productId: 'prod_1', channel: 'facebook',
      publishResults: [{ channel: 'facebook', success: true, externalId: 'fb_1' }, { channel: 'instagram', success: true, externalId: 'ig_1' }],
      channelDestinations: { facebook: 'page_1', instagram: 'ig_acct' },
    });

    const recordOnly = await call('pst_1');
    expect(await recordOnly.json()).toEqual({ deleted: true, id: 'pst_1', source: 'markaestro', platform: false });
    expect(deletePlatformPostMock).not.toHaveBeenCalled();
    expect(post.delete).toHaveBeenCalledTimes(1);

    const takenDown = await call('pst_1', '?platform=true');
    // Instagram offers no delete: skipped and said so, never attempted; the rest goes ahead.
    expect(await takenDown.json()).toEqual({
      deleted: true,
      id: 'pst_1',
      source: 'markaestro',
      platform: {
        channels: ['facebook'],
        skipped: [{ channel: 'instagram', reason: 'unsupported', message: expect.stringContaining('Instagram') }],
      },
    });
    expect(deletePlatformPostMock).toHaveBeenCalledTimes(1);
    expect(deletePlatformPostMock).toHaveBeenCalledWith('ws_1', expect.objectContaining({ channel: 'facebook', externalId: 'fb_1', destinationId: 'page_1' }));
    expect(post.delete).toHaveBeenCalledTimes(2);
  });

  it('keeps the record when a channel fails the takedown, and says what already went', async () => {
    const post = seed(`${POSTS}/pst_1`, {
      status: 'published', productId: 'prod_1', channel: 'facebook',
      publishResults: [{ channel: 'facebook', success: true, externalId: 'fb_1' }, { channel: 'threads', success: true, externalId: 'th_1' }],
    });
    deletePlatformPostMock.mockImplementation(async (_ws: string, input: { channel: string }) => (
      input.channel === 'threads'
        ? { ok: false, reason: 'transient', error: 'Threads is having a moment' }
        : { ok: true, connection: {} }
    ));

    const response = await call('pst_1', '?platform=true');

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual(expect.objectContaining({
      error: 'PLATFORM_ERROR', channel: 'threads', removedChannels: ['facebook'],
    }));
    expect(post.delete).not.toHaveBeenCalled();
  });

  it('treats a copy the platform no longer has as taken down', async () => {
    const post = seed(`${POSTS}/pst_1`, {
      status: 'published', productId: 'prod_1', channel: 'facebook', externalId: 'fb_1',
    });
    deletePlatformPostMock.mockResolvedValue({ ok: false, reason: 'not_found', error: 'gone' });

    const response = await call('pst_1', '?platform=true');

    expect(response.status).toBe(200);
    expect((await response.json()).platform).toEqual({ channels: ['facebook'], skipped: [] });
    expect(post.delete).toHaveBeenCalledTimes(1);
  });

  it('ignores platform=true for a draft, which has nothing live to take down', async () => {
    const post = seed(`${POSTS}/pst_draft`, { status: 'draft', productId: 'prod_1', channel: 'facebook' });
    requirePublicApiContextMock.mockResolvedValue(context(['posts.write']));

    const response = await call('pst_draft', '?platform=true');

    expect(response.status).toBe(200);
    expect((await response.json()).platform).toBe(false);
    expect(deletePlatformPostMock).not.toHaveBeenCalled();
    expect(post.delete).toHaveBeenCalledTimes(1);
  });

  it('answers 404 for an unknown id in either collection', async () => {
    seed(`${POSTS}/nope`, undefined);
    seed(`${SOCIAL}/nope`, undefined);
    expect((await call('nope')).status).toBe(404);
  });
});
