import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnection, PublishRequest } from '../platform/types';

const fetchWithRetryMock = vi.fn();
const getAccessTokenMock = vi.fn();
const transcodeForTikTokMock = vi.fn();

vi.mock('@/lib/fetch-retry', () => ({
  fetchWithRetry: fetchWithRetryMock,
}));

vi.mock('@/lib/platform/base-adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/base-adapter')>();
  return {
    ...actual,
    getAccessToken: getAccessTokenMock,
  };
});

// Skip the real ffmpeg pipeline in unit tests — return the buffer unchanged
// so we can assert FILE_UPLOAD wiring without a transcode binary.
vi.mock('@/lib/media/tiktok-transcode', () => ({
  transcodeForTikTok: transcodeForTikTokMock,
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

const videoUrl = 'https://firebasestorage.googleapis.com/v0/b/example-bucket/o/videos%2Fclip.mp4?alt=media&token=abc';
const request: PublishRequest = {
  content: 'Video caption',
  channel: 'tiktok',
  mediaUrls: [videoUrl],
};

describe('tiktokPublishingAdapter', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.OAUTH_BASE_URL = 'https://markaestro.com';
    getAccessTokenMock.mockReturnValue('access_token_123');
    // Default: pass the buffer through unchanged.
    transcodeForTikTokMock.mockImplementation(async (buf: Buffer) => buf);
  });

  it('always downloads, transcodes, and uploads via FILE_UPLOAD', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(Buffer.from([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'video/mp4', 'content-length': '3' },
    })));

    fetchWithRetryMock
      .mockResolvedValueOnce(jsonResponse({
        data: { publish_id: 'publish_123', upload_url: 'https://upload.tiktok.test/video' },
        error: { code: 'ok', message: '', log_id: 'log_123' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    const { tiktokPublishingAdapter } = await import('../platform/adapters/tiktok-publishing');
    const result = await tiktokPublishingAdapter.publish(connection, request);

    // Source URL is fetched directly — no preflight HEAD/Range probes.
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      videoUrl,
      expect.objectContaining({ redirect: 'error' }),
    );

    // Every TikTok upload goes through the transcoder for fps + audio compliance.
    expect(transcodeForTikTokMock).toHaveBeenCalledTimes(1);

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

  it('surfaces a transcode failure as a publish error instead of uploading bad bytes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(Buffer.from([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'video/mp4', 'content-length': '3' },
    })));
    transcodeForTikTokMock.mockRejectedValueOnce(new Error('ffmpeg exited with code 1'));

    const { tiktokPublishingAdapter } = await import('../platform/adapters/tiktok-publishing');
    const result = await tiktokPublishingAdapter.publish(connection, request);

    expect(fetchWithRetryMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: 'TikTok publish failed: Could not transcode video for TikTok upload: ffmpeg exited with code 1',
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

  // TikTok's video/post ids are 19-digit integers past Number.MAX_SAFE_INTEGER
  // (2^53-1). JSON.parse silently rounds them to the nearest representable
  // double, so any code path that round-trips one through res.json() instead
  // of reading it off the raw response text corrupts the last few digits.
  describe('big-integer id precision', () => {
    function textResponse(rawText: string, status = 200) {
      return { ok: status < 400, status, text: vi.fn().mockResolvedValue(rawText) };
    }

    it('fetchTikTokPublishStatus preserves full precision of the public post id', async () => {
      const rawText = '{"data":{"status":"SEND_TO_USER_INBOX","publicaly_available_post_id":[7671932290360020237]},"error":{"code":"ok","message":"","log_id":"log_1"}}';
      fetchWithRetryMock.mockResolvedValueOnce(textResponse(rawText));

      const { fetchTikTokPublishStatus } = await import('../platform/adapters/tiktok-publishing');
      const result = await fetchTikTokPublishStatus('token_123', 'publish_123');

      // JSON.parse on this same text would silently round the id to
      // ...020240 or similar -- assert the exact source digits survive.
      expect(result.publiclyAvailablePostId).toBe('7671932290360020237');
      expect(result.status).toBe('SEND_TO_USER_INBOX');
    });

    it('fetchMetrics trusts the server-side video_ids filter instead of re-matching a corrupted id', async () => {
      // TikTok's own response for a single-id-filtered query -- its `id`
      // field itself would be float-rounded once JSON.parse touches it, so
      // the fix must not compare it back against our stored id string.
      fetchWithRetryMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          data: {
            videos: [{ id: 7671932290360020237, like_count: 10, comment_count: 2, share_count: 1, view_count: 100 }],
          },
          error: { code: 'ok', message: '', log_id: 'log_1' },
        }),
      });

      const { tiktokPublishingAdapter } = await import('../platform/adapters/tiktok-publishing');
      const result = await tiktokPublishingAdapter.fetchMetrics!(connection, {
        channel: 'tiktok',
        externalId: '7671932290360020237',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.metrics.likes).toBe(10);
        expect(result.metrics.views).toBe(100);
      }
    });

    it('listPosts preserves full precision for every video id in a page', async () => {
      const rawText = '{"data":{"videos":[{"id":7671932290360020237,"title":"a"},{"id":7671893795729902861,"title":"b"}],"has_more":false,"cursor":0},"error":{"code":"ok","message":"","log_id":"log_1"}}';
      fetchWithRetryMock.mockResolvedValueOnce(textResponse(rawText));

      const { tiktokPublishingAdapter } = await import('../platform/adapters/tiktok-publishing');
      const result = await tiktokPublishingAdapter.listPosts!(connection, { channel: 'tiktok' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.posts.map((p) => p.externalId)).toEqual([
          '7671932290360020237',
          '7671893795729902861',
        ]);
      }
    });
  });
});
