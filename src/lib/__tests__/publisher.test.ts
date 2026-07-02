import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAdapterForChannelMock = vi.fn();
const getConnectionForChannelMock = vi.fn();
const getLinkedInConnectionForDestinationMock = vi.fn();
const markConnectionAuthErrorMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {},
}));

vi.mock('@/lib/platform/registry', () => ({
  getAdapterForChannel: getAdapterForChannelMock,
}));

vi.mock('@/lib/platform/connections', () => ({
  getConnectionForChannel: getConnectionForChannelMock,
  getLinkedInConnectionForDestination: getLinkedInConnectionForDestinationMock,
  markConnectionAuthError: markConnectionAuthErrorMock,
}));

vi.mock('@/lib/public-api/webhooks', () => ({
  enqueueWebhookEvent: vi.fn(),
}));

describe('publishPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLinkedInConnectionForDestinationMock.mockResolvedValue(null);
  });

  it('rejects TikTok posts without media before touching the adapter', async () => {
    const { publishPost } = await import('../social/publisher');

    const result = await publishPost('ws_123', undefined, {
      channel: 'tiktok',
      content: 'Demo',
      mediaUrls: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/TikTok requires media/);
    expect(getConnectionForChannelMock).not.toHaveBeenCalled();
    expect(getAdapterForChannelMock).not.toHaveBeenCalled();
  });

  it('pushes TikTok posts to the adapter using the platform inbox handoff', async () => {
    const publishMock = vi.fn().mockResolvedValue({
      success: false,
      pending: true,
      externalId: 'publish_abc',
    });
    getAdapterForChannelMock.mockReturnValue({
      publish: publishMock,
      validateConnection: () => null,
    });
    getConnectionForChannelMock.mockResolvedValue({ status: 'connected' });

    const { publishPost } = await import('../social/publisher');

    const result = await publishPost('ws_123', undefined, {
      channel: 'tiktok',
      content: 'Demo',
      mediaUrls: ['https://example.com/videos/demo.mp4'],
      deliveryMode: 'platform_inbox',
    });

    expect(result).toEqual({
      success: false,
      pending: true,
      externalId: 'publish_abc',
    });
    expect(getConnectionForChannelMock).toHaveBeenCalledWith('ws_123', 'tiktok', undefined, undefined);
    expect(publishMock).toHaveBeenCalledTimes(1);
  });
});

describe('publishStoredPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLinkedInConnectionForDestinationMock.mockResolvedValue(null);
  });

  it('publishes each explicit target channel without auto-expanding Meta destinations', async () => {
    const publishByChannel = {
      facebook: vi.fn().mockResolvedValue({
        success: true,
        externalId: 'fb_123',
        externalUrl: 'https://facebook.example/fb_123',
      }),
      threads: vi.fn().mockResolvedValue({
        success: true,
        externalId: 'th_123',
        externalUrl: 'https://threads.example/th_123',
      }),
    };

    getAdapterForChannelMock.mockImplementation((channel: keyof typeof publishByChannel) => ({
      publish: publishByChannel[channel],
      validateConnection: () => null,
    }));
    getConnectionForChannelMock.mockResolvedValue({ status: 'connected' });

    const { publishStoredPost } = await import('../social/publisher');

    const result = await publishStoredPost('ws_123', 'prod_123', {
      content: 'Launch post',
      channel: 'facebook',
      targetChannels: ['facebook', 'threads'],
      mediaUrls: [],
    });

    expect(result.success).toBe(true);
    expect(result.channels.map((item) => item.channel)).toEqual(['facebook', 'threads']);
    expect(getConnectionForChannelMock).toHaveBeenCalledWith('ws_123', 'facebook', 'prod_123', undefined);
    expect(getConnectionForChannelMock).toHaveBeenCalledWith('ws_123', 'threads', 'prod_123', undefined);
    expect(publishByChannel.facebook).toHaveBeenCalledTimes(1);
    expect(publishByChannel.threads).toHaveBeenCalledTimes(1);
  });

  it('reports a TikTok pending publish id before later channels finish', async () => {
    const onChannelResult = vi.fn().mockResolvedValue(undefined);
    const publishByChannel = {
      tiktok: vi.fn().mockResolvedValue({
        success: false,
        pending: true,
        externalId: 'publish_abc',
      }),
      threads: vi.fn().mockResolvedValue({
        success: true,
        externalId: 'threads_123',
      }),
    };

    getAdapterForChannelMock.mockImplementation((channel: keyof typeof publishByChannel) => ({
      publish: publishByChannel[channel],
      validateConnection: () => null,
    }));
    getConnectionForChannelMock.mockResolvedValue({ status: 'connected' });

    const { publishStoredPost } = await import('../social/publisher');

    const result = await publishStoredPost('ws_123', 'prod_123', {
      content: 'Launch post',
      channel: 'tiktok',
      targetChannels: ['tiktok', 'threads'],
      mediaUrls: ['https://example.com/video.mp4'],
    }, { onChannelResult });

    expect(result.pending).toBe(true);
    expect(onChannelResult).toHaveBeenNthCalledWith(1, {
      channel: 'tiktok',
      success: false,
      pending: true,
      externalId: 'publish_abc',
    });
    expect(onChannelResult).toHaveBeenNthCalledWith(2, {
      channel: 'threads',
      success: true,
      externalId: 'threads_123',
    });
  });

  it('requires a product for non-TikTok stored posts', async () => {
    const { publishStoredPost } = await import('../social/publisher');

    const result = await publishStoredPost('ws_123', undefined, {
      content: 'Launch post',
      channel: 'facebook',
      targetChannels: ['facebook'],
    });

    expect(result).toEqual({
      success: false,
      channels: [],
      error: 'Post has no associated product',
    });
    expect(getConnectionForChannelMock).not.toHaveBeenCalled();
  });

  it('does not publish through the legacy channel fallback when targetChannels is explicitly empty', async () => {
    const { getPostTargetChannels, publishStoredPost } = await import('../social/publisher');

    const post = {
      content: 'Launch post',
      channel: 'facebook',
      targetChannels: [],
    };

    expect(getPostTargetChannels(post)).toEqual([]);

    const result = await publishStoredPost('ws_123', 'prod_123', post);

    expect(result).toEqual({
      success: false,
      channels: [],
      error: 'Post has no target channel',
    });
    expect(getConnectionForChannelMock).not.toHaveBeenCalled();
  });

  it('retries only failed channels after a partial failure', async () => {
    const facebookPublish = vi.fn().mockResolvedValue({
      success: true,
      externalId: 'fb_new',
    });
    const instagramPublish = vi.fn().mockResolvedValue({
      success: true,
      externalId: 'ig_123',
    });

    getAdapterForChannelMock.mockImplementation((channel: string) => ({
      publish: channel === 'facebook' ? facebookPublish : instagramPublish,
      validateConnection: () => null,
    }));
    getConnectionForChannelMock.mockResolvedValue({ status: 'connected' });

    const { publishStoredPost } = await import('../social/publisher');

    const result = await publishStoredPost('ws_123', 'prod_123', {
      status: 'partial_failed',
      content: 'Launch post',
      channel: 'facebook',
      targetChannels: ['facebook', 'instagram'],
      mediaUrls: ['https://example.com/image.jpg'],
      publishResults: [
        { channel: 'facebook', success: true, externalId: 'fb_123' },
        { channel: 'instagram', success: false, error: 'previous failure' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.channels).toEqual([
      { channel: 'facebook', success: true, externalId: 'fb_123' },
      { channel: 'instagram', success: true, externalId: 'ig_123' },
    ]);
    expect(facebookPublish).not.toHaveBeenCalled();
    expect(instagramPublish).toHaveBeenCalledTimes(1);
    expect(getConnectionForChannelMock).toHaveBeenCalledTimes(1);
    expect(getConnectionForChannelMock).toHaveBeenCalledWith('ws_123', 'instagram', 'prod_123', undefined);
  });
});
