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
    process.env.OAUTH_BASE_URL = 'https://markaestro.com';
    getAccessTokenMock.mockReturnValue('access_token_123');
  });

  it('uses a verified-domain PULL_FROM_URL flow for videos', async () => {
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse({
      data: { publish_id: 'publish_123', upload_url: 'unused-for-pull-from-url' },
      error: { code: 'ok', message: '', log_id: 'log_123' },
    }));

    const { tiktokPublishingAdapter } = await import('../platform/adapters/tiktok-publishing');
    const result = await tiktokPublishingAdapter.publish(connection, request);

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
