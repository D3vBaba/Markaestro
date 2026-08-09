import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnection } from '../platform/types';

const fetchWithRetryMock = vi.fn();
const graphApiFetchMock = vi.fn();

vi.mock('@/lib/crypto', () => ({
  decrypt: (value: string) => `decrypted:${value}`,
  encrypt: (value: string) => value,
}));

vi.mock('@/lib/fetch-retry', () => ({
  fetchWithRetry: fetchWithRetryMock,
}));

vi.mock('@/lib/platform/meta-graph-api', () => ({
  graphApiFetch: (...args: unknown[]) => graphApiFetchMock(...args),
  checkIgPublishingQuota: vi.fn().mockResolvedValue({ quotaUsage: 0, quotaTotal: 50, remaining: 50 }),
  checkPagePublishingAccess: vi.fn().mockResolvedValue({ canPublish: true }),
}));

// Skip the real ffmpeg pipeline pulled in by the TikTok adapter module.
vi.mock('@/lib/media/tiktok-transcode', () => ({
  transcodeForTikTok: vi.fn(),
}));

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function connection(overrides: Partial<PlatformConnection>): PlatformConnection {
  return {
    provider: 'meta',
    channels: [],
    capabilities: [],
    status: 'connected',
    accessTokenEncrypted: 'enc',
    metadata: {},
    workspaceId: 'ws_123',
    productId: 'prod_123',
    updatedBy: 'user_123',
    updatedAt: '2026-06-21T00:00:00.000Z',
    createdAt: '2026-06-21T00:00:00.000Z',
    ...overrides,
  } as PlatformConnection;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Meta (Facebook) ──────────────────────────────────────────────────

describe('metaPublishingAdapter.listPosts — facebook', () => {
  const fbConnection = connection({
    provider: 'meta',
    channels: ['facebook'],
    metadata: { pageId: 'page_1', pageAccessTokenEncrypted: 'page_enc' },
  });

  it('lists page posts with the page token and maps fields', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    graphApiFetchMock.mockResolvedValueOnce(jsonResponse(200, {
      data: [
        {
          id: 'page_1_post_9',
          message: 'Hello world',
          created_time: '2026-06-01T10:00:00+0000',
          permalink_url: 'https://facebook.com/page_1/posts/post_9',
          full_picture: 'https://cdn/img.jpg',
          attachments: { data: [{ media_type: 'photo' }] },
        },
      ],
      paging: { cursors: { after: 'cursor_abc' }, next: 'https://graph/next' },
    }));

    const result = await metaPublishingAdapter.listPosts!(fbConnection, { channel: 'facebook' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toEqual({
      externalId: 'page_1_post_9',
      channel: 'facebook',
      content: 'Hello world',
      mediaType: 'image',
      mediaUrl: 'https://cdn/img.jpg',
      thumbnailUrl: 'https://cdn/img.jpg',
      permalink: 'https://facebook.com/page_1/posts/post_9',
      publishedAt: new Date('2026-06-01T10:00:00+0000').toISOString(),
      canDelete: true,
    });
    expect(result.nextCursor).toBe('cursor_abc');

    const [url, init] = graphApiFetchMock.mock.calls[0];
    expect(url).toContain('/page_1/published_posts?');
    expect(url).toContain('limit=24');
    expect(init.headers.Authorization).toBe('Bearer decrypted:page_enc');
  });

  it('passes the cursor through and omits nextCursor on the last page', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    graphApiFetchMock.mockResolvedValueOnce(jsonResponse(200, {
      data: [],
      paging: { cursors: { after: 'tail' } }, // no `next` → last page
    }));

    const result = await metaPublishingAdapter.listPosts!(fbConnection, { channel: 'facebook', cursor: 'cursor_abc', limit: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextCursor).toBeUndefined();
    const [url] = graphApiFetchMock.mock.calls[0];
    expect(url).toContain('after=cursor_abc');
    expect(url).toContain('limit=10');
  });

  it('classifies an expired token as auth', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    graphApiFetchMock.mockResolvedValueOnce(jsonResponse(401, {
      error: { code: 190, message: 'Error validating access token' },
    }));

    const result = await metaPublishingAdapter.listPosts!(fbConnection, { channel: 'facebook' });
    expect(result).toEqual({ ok: false, error: 'Error validating access token', reason: 'auth' });
  });

  it('returns unsupported when no page is selected', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    const result = await metaPublishingAdapter.listPosts!(
      connection({ provider: 'meta', metadata: {} }),
      { channel: 'facebook' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported');
    expect(graphApiFetchMock).not.toHaveBeenCalled();
  });
});

describe('metaPublishingAdapter.deletePost', () => {
  const fbConnection = connection({
    provider: 'meta',
    metadata: { pageId: 'page_1', pageAccessTokenEncrypted: 'page_enc' },
  });

  it('deletes a Facebook post with the page token', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    graphApiFetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true }));

    const result = await metaPublishingAdapter.deletePost!(fbConnection, {
      channel: 'facebook',
      externalId: 'page_1_post_9',
    });

    expect(result).toEqual({ ok: true });
    const [url, init] = graphApiFetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v22.0/page_1_post_9');
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe('Bearer decrypted:page_enc');
  });

  it('classifies a missing post as not_found', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    graphApiFetchMock.mockResolvedValueOnce(jsonResponse(400, {
      error: { code: 100, message: 'Object does not exist' },
    }));

    const result = await metaPublishingAdapter.deletePost!(fbConnection, {
      channel: 'facebook',
      externalId: 'gone_1',
    });
    expect(result).toEqual({ ok: false, error: 'Object does not exist', reason: 'not_found' });
  });

  it('refuses Instagram deletes as unsupported without calling the API', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    const result = await metaPublishingAdapter.deletePost!(fbConnection, {
      channel: 'instagram',
      externalId: 'ig_media_1',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported');
    expect(graphApiFetchMock).not.toHaveBeenCalled();
  });
});

// ── Meta (Instagram) ─────────────────────────────────────────────────

describe('metaPublishingAdapter.listPosts — instagram', () => {
  it('lists IG media via the Facebook Graph host for Meta-login connections', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    const igConnection = connection({
      provider: 'meta',
      metadata: { igAccountId: 'ig_55', pageAccessTokenEncrypted: 'page_enc' },
    });
    graphApiFetchMock.mockResolvedValueOnce(jsonResponse(200, {
      data: [
        {
          id: 'media_1',
          caption: 'Sunset',
          media_type: 'CAROUSEL_ALBUM',
          media_url: 'https://cdn/carousel.jpg',
          permalink: 'https://instagram.com/p/abc',
          timestamp: '2026-05-30T08:00:00+0000',
        },
      ],
    }));

    const result = await metaPublishingAdapter.listPosts!(igConnection, { channel: 'instagram' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0]).toMatchObject({
      externalId: 'media_1',
      channel: 'instagram',
      content: 'Sunset',
      mediaType: 'carousel',
      permalink: 'https://instagram.com/p/abc',
      canDelete: false,
    });
    const [url] = graphApiFetchMock.mock.calls[0];
    expect(url).toContain('https://graph.facebook.com/v22.0/ig_55/media?');
  });

  it('lists IG media via /me/media with a query token for Instagram-login connections', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    const igLoginConnection = connection({
      provider: 'instagram',
      metadata: { igAccountId: 'ig_55' },
    });
    graphApiFetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }));

    const result = await metaPublishingAdapter.listPosts!(igLoginConnection, { channel: 'instagram' });

    expect(result.ok).toBe(true);
    const [url, init] = graphApiFetchMock.mock.calls[0];
    expect(url).toContain('https://graph.instagram.com/v25.0/me/media?');
    expect(url).toContain('access_token=decrypted%3Aenc');
    expect(init).toEqual({});
  });
});

// ── Threads ──────────────────────────────────────────────────────────

describe('threadsPublishingAdapter list/delete', () => {
  const threadsConnection = connection({
    provider: 'threads',
    channels: ['threads'],
    metadata: { threadsUserId: 'th_user_1', username: 'brand' },
  });

  it('lists threads with fields and access token, mapping media types', async () => {
    const { threadsPublishingAdapter } = await import('@/lib/platform/adapters/threads-publishing');
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse(200, {
      data: [
        {
          id: 'thread_1',
          text: 'A text post',
          media_type: 'TEXT_POST',
          permalink: 'https://threads.net/@brand/post/thread_1',
          timestamp: '2026-06-10T12:00:00+0000',
        },
        {
          id: 'thread_2',
          media_type: 'VIDEO',
          media_url: 'https://cdn/video.mp4',
          thumbnail_url: 'https://cdn/thumb.jpg',
          timestamp: '2026-06-09T12:00:00+0000',
        },
      ],
      paging: { cursors: { after: 'th_cursor' }, next: 'https://graph.threads.net/next' },
    }));

    const result = await threadsPublishingAdapter.listPosts!(threadsConnection, { channel: 'threads' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0]).toMatchObject({
      externalId: 'thread_1',
      channel: 'threads',
      content: 'A text post',
      mediaType: 'text',
      canDelete: true,
    });
    expect(result.posts[1]).toMatchObject({
      externalId: 'thread_2',
      mediaType: 'video',
      mediaUrl: 'https://cdn/video.mp4',
      thumbnailUrl: 'https://cdn/thumb.jpg',
    });
    expect(result.nextCursor).toBe('th_cursor');

    const [url] = fetchWithRetryMock.mock.calls[0];
    expect(url).toContain('https://graph.threads.net/v1.0/th_user_1/threads?');
    expect(url).toContain('access_token=decrypted%3Aenc');
    expect(url).toContain('fields=');
  });

  it('deletes a thread via DELETE {mediaId}', async () => {
    const { threadsPublishingAdapter } = await import('@/lib/platform/adapters/threads-publishing');
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse(200, { success: true }));

    const result = await threadsPublishingAdapter.deletePost!(threadsConnection, {
      channel: 'threads',
      externalId: 'thread_1',
    });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchWithRetryMock.mock.calls[0];
    expect(url).toContain('https://graph.threads.net/v1.0/thread_1?');
    expect(url).toContain('access_token=decrypted%3Aenc');
    expect(init.method).toBe('DELETE');
  });

  it('surfaces a missing threads_delete permission as unsupported with a reconnect hint', async () => {
    const { threadsPublishingAdapter } = await import('@/lib/platform/adapters/threads-publishing');
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse(403, {
      error: { code: 200, message: 'Permission threads_delete is not granted' },
    }));

    const result = await threadsPublishingAdapter.deletePost!(threadsConnection, {
      channel: 'threads',
      externalId: 'thread_1',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported');
    expect(result.error).toContain('Reconnect Threads');
  });

  it('returns unsupported when the connection has no threads user id', async () => {
    const { threadsPublishingAdapter } = await import('@/lib/platform/adapters/threads-publishing');
    const result = await threadsPublishingAdapter.listPosts!(
      connection({ provider: 'threads', metadata: {} }),
      { channel: 'threads' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported');
    expect(fetchWithRetryMock).not.toHaveBeenCalled();
  });
});

// ── LinkedIn ─────────────────────────────────────────────────────────

describe('linkedinPublishingAdapter list/delete', () => {
  const profileConnection = connection({
    provider: 'linkedin_profile',
    channels: ['linkedin'],
    metadata: {
      linkedinProfileId: 'person_123',
      linkedinProfileUrn: 'urn:li:person:person_123',
      linkedinProfileName: 'Pat Publisher',
      linkedinDestinationUrn: 'urn:li:person:person_123',
      linkedinDestinationType: 'profile',
      linkedinDestinationName: 'Pat Publisher',
      linkedinDestinationAccountId: 'person_123',
      linkedinScopes: ['w_member_social'],
      linkedinPages: [],
    },
  });

  it('lists posts via the author finder with versioned headers', async () => {
    const { linkedinPublishingAdapter } = await import('@/lib/platform/adapters/linkedin-publishing');
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse(200, {
      elements: [
        {
          id: 'urn:li:share:100',
          commentary: 'Launch update',
          publishedAt: 1750000000000,
          content: { media: { id: 'urn:li:image:img1' } },
        },
      ],
      paging: { start: 0, count: 24, total: 1 },
    }));

    const result = await linkedinPublishingAdapter.listPosts!(profileConnection, { channel: 'linkedin' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0]).toEqual({
      externalId: 'urn:li:share:100',
      channel: 'linkedin',
      content: 'Launch update',
      mediaType: 'image',
      mediaUrl: null,
      thumbnailUrl: null,
      permalink: 'https://www.linkedin.com/feed/update/urn:li:share:100/',
      publishedAt: new Date(1750000000000).toISOString(),
      canDelete: true,
    });
    expect(result.nextCursor).toBeUndefined();

    const [url, init] = fetchWithRetryMock.mock.calls[0];
    expect(url).toContain('https://api.linkedin.com/rest/posts?author=urn%3Ali%3Aperson%3Aperson_123&q=author');
    expect(init.headers.Authorization).toBe('Bearer decrypted:enc');
    expect(init.headers['Linkedin-Version']).toBeTruthy();
  });

  it('returns a numeric offset cursor when a full page comes back', async () => {
    const { linkedinPublishingAdapter } = await import('@/lib/platform/adapters/linkedin-publishing');
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse(200, {
      elements: Array.from({ length: 2 }, (_, i) => ({ id: `urn:li:share:${i}`, createdAt: 1750000000000 })),
      paging: { start: 0, count: 2, total: 10 },
    }));

    const result = await linkedinPublishingAdapter.listPosts!(profileConnection, { channel: 'linkedin', limit: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextCursor).toBe('2');
  });

  it('classifies a 403 on listing as unsupported', async () => {
    const { linkedinPublishingAdapter } = await import('@/lib/platform/adapters/linkedin-publishing');
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse(403, { message: 'Not enough permissions' }));

    const result = await linkedinPublishingAdapter.listPosts!(profileConnection, { channel: 'linkedin' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported');
  });

  it('deletes a post via DELETE /rest/posts/{urn}', async () => {
    const { linkedinPublishingAdapter } = await import('@/lib/platform/adapters/linkedin-publishing');
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse(204, {}));

    const result = await linkedinPublishingAdapter.deletePost!(profileConnection, {
      channel: 'linkedin',
      externalId: 'urn:li:share:100',
    });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchWithRetryMock.mock.calls[0];
    expect(url).toBe('https://api.linkedin.com/rest/posts/urn%3Ali%3Ashare%3A100');
    expect(init.method).toBe('DELETE');
  });

  it('classifies a 404 delete as not_found', async () => {
    const { linkedinPublishingAdapter } = await import('@/lib/platform/adapters/linkedin-publishing');
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse(404, { message: 'Post not found' }));

    const result = await linkedinPublishingAdapter.deletePost!(profileConnection, {
      channel: 'linkedin',
      externalId: 'urn:li:share:999',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_found');
  });

  it('blocks deletes without the destination scope before any API call', async () => {
    const { linkedinPublishingAdapter } = await import('@/lib/platform/adapters/linkedin-publishing');
    const noScope = connection({
      provider: 'linkedin_profile',
      metadata: { ...profileConnection.metadata, linkedinScopes: [] },
    });

    const result = await linkedinPublishingAdapter.deletePost!(noScope, {
      channel: 'linkedin',
      externalId: 'urn:li:share:100',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported');
    expect(fetchWithRetryMock).not.toHaveBeenCalled();
  });
});

// ── TikTok ───────────────────────────────────────────────────────────

describe('tiktokPublishingAdapter list/delete', () => {
  const tiktokConnection = connection({ provider: 'tiktok', channels: ['tiktok'], metadata: {} });

  it('lists videos via the Display API and maps fields', async () => {
    const { tiktokPublishingAdapter } = await import('@/lib/platform/adapters/tiktok-publishing');
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse(200, {
      data: {
        videos: [
          {
            id: 7412345,
            title: 'Clip title',
            video_description: 'Watch this',
            create_time: 1750000000,
            cover_image_url: 'https://cdn/cover.jpg',
            share_url: 'https://tiktok.com/@u/video/7412345',
          },
        ],
        cursor: 1749990000,
        has_more: true,
      },
      error: { code: 'ok' },
    }));

    const result = await tiktokPublishingAdapter.listPosts!(tiktokConnection, { channel: 'tiktok' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0]).toEqual({
      externalId: '7412345',
      channel: 'tiktok',
      content: 'Watch this',
      mediaType: 'video',
      mediaUrl: null,
      thumbnailUrl: 'https://cdn/cover.jpg',
      permalink: 'https://tiktok.com/@u/video/7412345',
      publishedAt: new Date(1750000000 * 1000).toISOString(),
      canDelete: false,
    });
    expect(result.nextCursor).toBe('1749990000');

    const [url, init] = fetchWithRetryMock.mock.calls[0];
    expect(url).toContain('/v2/video/list/?fields=');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer decrypted:enc');
    expect(JSON.parse(init.body)).toEqual({ max_count: 20 });
  });

  it('sends the numeric cursor on subsequent pages', async () => {
    const { tiktokPublishingAdapter } = await import('@/lib/platform/adapters/tiktok-publishing');
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse(200, {
      data: { videos: [], cursor: 0, has_more: false },
      error: { code: 'ok' },
    }));

    const result = await tiktokPublishingAdapter.listPosts!(tiktokConnection, { channel: 'tiktok', cursor: '1749990000' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextCursor).toBeUndefined();
    const [, init] = fetchWithRetryMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ max_count: 20, cursor: 1749990000 });
  });

  it('classifies a missing video.list scope as unsupported', async () => {
    const { tiktokPublishingAdapter } = await import('@/lib/platform/adapters/tiktok-publishing');
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse(200, {
      error: { code: 'scope_not_authorized', message: 'scope missing' },
    }));

    const result = await tiktokPublishingAdapter.listPosts!(tiktokConnection, { channel: 'tiktok' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported');
  });

  it('refuses deletes as unsupported without calling the API', async () => {
    const { tiktokPublishingAdapter } = await import('@/lib/platform/adapters/tiktok-publishing');
    const result = await tiktokPublishingAdapter.deletePost!(tiktokConnection, {
      channel: 'tiktok',
      externalId: '7412345',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported');
    expect(fetchWithRetryMock).not.toHaveBeenCalled();
  });
});

// ── Pinterest ────────────────────────────────────────────────────────

describe('pinterestPublishingAdapter list/delete', () => {
  const pinterestConnection = connection({
    provider: 'pinterest',
    channels: ['pinterest'],
    metadata: { boardId: 'board_1' },
  });

  it('lists pins with a bookmark cursor and maps fields', async () => {
    const { pinterestPublishingAdapter } = await import('@/lib/platform/adapters/pinterest-publishing');
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse(200, {
      items: [
        {
          id: 'pin_1',
          created_at: '2026-06-05T09:00:00',
          title: 'Summer look',
          description: 'New arrivals',
          media: {
            media_type: 'image',
            images: { '600x': { url: 'https://cdn/pin600.jpg' } },
          },
        },
      ],
      bookmark: 'bm_next',
    }));

    const result = await pinterestPublishingAdapter.listPosts!(pinterestConnection, { channel: 'pinterest' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0]).toMatchObject({
      externalId: 'pin_1',
      channel: 'pinterest',
      content: 'New arrivals',
      mediaType: 'image',
      thumbnailUrl: 'https://cdn/pin600.jpg',
      permalink: 'https://www.pinterest.com/pin/pin_1/',
      canDelete: true,
    });
    expect(result.nextCursor).toBe('bm_next');

    const [url, init] = fetchWithRetryMock.mock.calls[0];
    expect(url).toContain('https://api.pinterest.com/v5/pins?page_size=24');
    expect(init.headers.Authorization).toBe('Bearer decrypted:enc');
  });

  it('deletes a pin and treats 204 as success', async () => {
    const { pinterestPublishingAdapter } = await import('@/lib/platform/adapters/pinterest-publishing');
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse(204, {}));

    const result = await pinterestPublishingAdapter.deletePost!(pinterestConnection, {
      channel: 'pinterest',
      externalId: 'pin_1',
    });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchWithRetryMock.mock.calls[0];
    expect(url).toBe('https://api.pinterest.com/v5/pins/pin_1');
    expect(init.method).toBe('DELETE');
  });

  it('classifies a 404 delete as not_found and a 401 as auth', async () => {
    const { pinterestPublishingAdapter } = await import('@/lib/platform/adapters/pinterest-publishing');

    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse(404, { message: 'Pin not found' }));
    const notFound = await pinterestPublishingAdapter.deletePost!(pinterestConnection, {
      channel: 'pinterest',
      externalId: 'pin_x',
    });
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) expect(notFound.reason).toBe('not_found');

    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Invalid token' }));
    const auth = await pinterestPublishingAdapter.deletePost!(pinterestConnection, {
      channel: 'pinterest',
      externalId: 'pin_x',
    });
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.reason).toBe('auth');
  });
});
