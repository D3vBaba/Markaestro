import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnection, PublishRequest } from '../platform/types';

const fetchWithRetryMock = vi.fn();
const getAccessTokenMock = vi.fn();

vi.mock('@/lib/fetch-retry', () => ({
  fetchWithRetry: fetchWithRetryMock,
}));

vi.mock('@/lib/platform/base-adapter', () => ({
  getAccessToken: getAccessTokenMock,
}));

function jsonResponse(body: unknown) {
  return {
    json: vi.fn().mockResolvedValue(body),
  };
}

const connection: PlatformConnection = {
  provider: 'tiktok',
  channels: ['tiktok'],
  capabilities: [],
  status: 'connected',
  accessTokenEncrypted: 'encrypted',
  metadata: {},
  workspaceId: 'ws_123',
  updatedBy: 'user_123',
  updatedAt: '2026-04-21T00:00:00.000Z',
  createdAt: '2026-04-21T00:00:00.000Z',
};

const request: PublishRequest = {
  content: 'Video caption',
  channel: 'tiktok',
  mediaUrls: ['https://firebasestorage.googleapis.com/v0/b/example-bucket/o/videos%2Fclip.mp4?alt=media&token=abc'],
};

describe('tiktokPublishingAdapter', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.OAUTH_BASE_URL = 'https://markaestro.com';
    getAccessTokenMock.mockReturnValue('access_token_123');
  });

  it('uses a verified-domain PULL_FROM_URL flow for videos', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-length': '123',
          'accept-ranges': 'bytes',
        },
      }))
      .mockResolvedValueOnce(new Response(Buffer.from([0]), {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-length': '1',
          'content-range': 'bytes 0-0/123',
          'accept-ranges': 'bytes',
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse({
      data: { publish_id: 'publish_123', upload_url: 'unused-for-pull-from-url' },
      error: { code: 'ok', message: '', log_id: 'log_123' },
    }));

    const { tiktokPublishingAdapter } = await import('../platform/adapters/tiktok-publishing');
    const result = await tiktokPublishingAdapter.publish(connection, request);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://markaestro.com/api/media/video-proxy?url=https%3A%2F%2Ffirebasestorage.googleapis.com%2Fv0%2Fb%2Fexample-bucket%2Fo%2Fvideos%252Fclip.mp4%3Falt%3Dmedia%26token%3Dabc',
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://markaestro.com/api/media/video-proxy?url=https%3A%2F%2Ffirebasestorage.googleapis.com%2Fv0%2Fb%2Fexample-bucket%2Fo%2Fvideos%252Fclip.mp4%3Falt%3Dmedia%26token%3Dabc',
      expect.objectContaining({ headers: { Range: 'bytes=0-0' }, redirect: 'manual' }),
    );
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
    expect(fetchWithRetryMock).toHaveBeenCalledWith(
      'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access_token_123',
        }),
      }),
    );

    const [, init] = fetchWithRetryMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: 'https://markaestro.com/api/media/video-proxy?url=https%3A%2F%2Ffirebasestorage.googleapis.com%2Fv0%2Fb%2Fexample-bucket%2Fo%2Fvideos%252Fclip.mp4%3Falt%3Dmedia%26token%3Dabc',
      },
    });
    expect(result).toEqual({
      success: false,
      pending: true,
      externalId: 'publish_123',
    });
  });

  it('falls back to FILE_UPLOAD when the public URL returns full-body 200 for the range probe', async () => {
    vi.stubGlobal('fetch', vi
      .fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-length': '123',
          'accept-ranges': 'bytes',
        },
      }))
      .mockResolvedValueOnce(new Response(Buffer.from([0]), {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-length': '123',
          'accept-ranges': 'bytes',
        },
      }))
      .mockResolvedValueOnce(new Response(Buffer.from([1, 2, 3]), {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-length': '3',
        },
      })));

    fetchWithRetryMock
      .mockResolvedValueOnce(jsonResponse({
        data: { publish_id: 'publish_123', upload_url: 'https://upload.tiktok.test/video' },
        error: { code: 'ok', message: '', log_id: 'log_123' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    const { tiktokPublishingAdapter } = await import('../platform/adapters/tiktok-publishing');
    const result = await tiktokPublishingAdapter.publish(connection, request);

    expect(fetchWithRetryMock).toHaveBeenCalledWith(
      'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: 3,
            chunk_size: 3,
            total_chunk_count: 1,
          },
        }),
      }),
    );
    expect(fetchWithRetryMock).toHaveBeenCalledWith(
      'https://upload.tiktok.test/video',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'Content-Length': '3',
          'Content-Range': 'bytes 0-2/3',
        }),
      }),
      expect.objectContaining({ timeoutMs: 120_000 }),
    );
    expect(result).toEqual({
      success: false,
      pending: true,
      externalId: 'publish_123',
    });
  });

  it('uses a ceiling chunk count for large TikTok FILE_UPLOAD videos', async () => {
    const { getTikTokFileUploadPlan } = await import('../platform/adapters/tiktok-publishing');

    expect(getTikTokFileUploadPlan((65 * 1024 * 1024) + 1)).toEqual({
      chunkSize: 10 * 1024 * 1024,
      totalChunkCount: 7,
    });
  });

  it('rejects TikTok posts with multiple videos', async () => {
    const { tiktokPublishingAdapter } = await import('../platform/adapters/tiktok-publishing');
    const result = await tiktokPublishingAdapter.publish(connection, {
      ...request,
      mediaUrls: [
        'https://firebasestorage.googleapis.com/v0/b/example-bucket/o/videos%2Fclip-1.mp4?alt=media&token=abc',
        'https://firebasestorage.googleapis.com/v0/b/example-bucket/o/videos%2Fclip-2.mp4?alt=media&token=def',
      ],
    });

    expect(fetchWithRetryMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: 'TikTok supports only one video per post.',
    });
  });

  it('rejects TikTok posts that mix videos and images', async () => {
    const { tiktokPublishingAdapter } = await import('../platform/adapters/tiktok-publishing');
    const result = await tiktokPublishingAdapter.publish(connection, {
      ...request,
      mediaUrls: [
        'https://firebasestorage.googleapis.com/v0/b/example-bucket/o/videos%2Fclip-1.mp4?alt=media&token=abc',
        'https://firebasestorage.googleapis.com/v0/b/example-bucket/o/public-media%2Fframe-1.jpg?alt=media&token=def',
      ],
    });

    expect(fetchWithRetryMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: 'TikTok does not support mixing video and image assets in one post.',
    });
  });
});
