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

  it('refuses a payload the channel contract does not allow, before the adapter', async () => {
    // The metrics half of PLATFORM_CAPABILITY_REGISTRY has policed adapter
    // responses since it was written; the publishing half had no runtime
    // contract at all, so a drifted declaration cost nothing until a user hit
    // it. Instagram requires media, so a text-only post must never reach the
    // platform.
    getAdapterForChannelMock.mockReturnValue({
      publish: vi.fn(),
      validateConnection: () => null,
    });

    const { publishPost } = await import('../social/publisher');

    const result = await publishPost('ws_123', 'brand1', {
      channel: 'instagram',
      content: 'Caption only',
      mediaUrls: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/requires at least one image or video/);
    expect(getConnectionForChannelMock).not.toHaveBeenCalled();
  });

  it('states the real ceiling when a post exceeds a channel media limit', async () => {
    getAdapterForChannelMock.mockReturnValue({
      publish: vi.fn(),
      validateConnection: () => null,
    });

    const { publishPost } = await import('../social/publisher');

    const result = await publishPost('ws_123', 'brand1', {
      channel: 'pinterest',
      content: 'Six images',
      mediaUrls: Array.from({ length: 6 }, (_, i) => `https://cdn.example.com/${i}.jpg`),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('5');
    expect(result.error).toContain('6');
  });

  it('lets a payload the contract allows through to the adapter', async () => {
    const publishMock = vi.fn().mockResolvedValue({ success: true, externalId: 'ig_1' });
    getAdapterForChannelMock.mockReturnValue({
      publish: publishMock,
      validateConnection: () => null,
    });
    getConnectionForChannelMock.mockResolvedValue({ status: 'connected' });

    const { publishPost } = await import('../social/publisher');

    const result = await publishPost('ws_123', 'brand1', {
      channel: 'instagram',
      content: 'With an image',
      mediaUrls: ['https://cdn.example.com/a.jpg'],
    });

    expect(result.success).toBe(true);
    expect(publishMock).toHaveBeenCalled();
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
    expect(getConnectionForChannelMock).toHaveBeenCalledWith('ws_123', 'tiktok', undefined, undefined, undefined);
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
    expect(getConnectionForChannelMock).toHaveBeenCalledWith('ws_123', 'facebook', 'prod_123', undefined, undefined);
    expect(getConnectionForChannelMock).toHaveBeenCalledWith('ws_123', 'threads', 'prod_123', undefined, undefined);
    expect(publishByChannel.facebook).toHaveBeenCalledTimes(1);
    expect(publishByChannel.threads).toHaveBeenCalledTimes(1);
  });

  it('publishes the channels that validate and fails only the ones that do not (4.7)', async () => {
    // 8 images targeting Facebook (limit 10) and Pinterest (limit 5) used to
    // fail entirely on the first issue: Facebook was never attempted even
    // though it would have accepted the post. Now Facebook publishes and
    // Pinterest lands as a per-channel failure with a precise reason.
    const publishByChannel = {
      facebook: vi.fn().mockResolvedValue({
        success: true,
        externalId: 'fb_1',
        externalUrl: 'https://facebook.example/fb_1',
      }),
      pinterest: vi.fn(),
    };
    getAdapterForChannelMock.mockImplementation((channel: keyof typeof publishByChannel) => ({
      publish: publishByChannel[channel],
      validateConnection: () => null,
    }));
    getConnectionForChannelMock.mockResolvedValue({ status: 'connected' });

    const { publishStoredPost } = await import('../social/publisher');

    const result = await publishStoredPost('ws_123', 'prod_123', {
      content: 'Gallery',
      channel: 'facebook',
      targetChannels: ['facebook', 'pinterest'],
      mediaUrls: Array.from({ length: 8 }, (_, i) => `https://example.com/${i}.jpg`),
    });

    expect(result.success).toBe(false);
    expect(result.partialFailure).toBe(true);
    expect(publishByChannel.facebook).toHaveBeenCalledTimes(1);
    // Pinterest never reaches its adapter: validation failed it up front.
    expect(publishByChannel.pinterest).not.toHaveBeenCalled();
    const pinterest = result.channels.find((entry) => entry.channel === 'pinterest');
    expect(pinterest?.success).toBe(false);
    expect(pinterest?.error).toMatch(/up to 5 media items/);
    const facebook = result.channels.find((entry) => entry.channel === 'facebook');
    expect(facebook?.success).toBe(true);
  });

  it('still fails the whole post when every channel objects', async () => {
    getAdapterForChannelMock.mockReturnValue({ publish: vi.fn(), validateConnection: () => null });

    const { publishStoredPost } = await import('../social/publisher');

    const result = await publishStoredPost('ws_123', 'prod_123', {
      content: '',
      channel: 'instagram',
      targetChannels: ['instagram', 'pinterest'],
      mediaUrls: [],
    });

    expect(result.success).toBe(false);
    // The single-error contract survives for callers that only read `error`.
    expect(result.error).toMatch(/requires at least one image or video/);
    expect(result.channels.map((entry) => entry.channel).sort()).toEqual(['instagram', 'pinterest']);
    expect(result.channels.every((entry) => !entry.success)).toBe(true);
    expect(getConnectionForChannelMock).not.toHaveBeenCalled();
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
    expect(getConnectionForChannelMock).toHaveBeenCalledWith('ws_123', 'instagram', 'prod_123', undefined, undefined);
  });
});
