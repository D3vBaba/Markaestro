import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAdapterForChannelMock = vi.fn();
const getConnectionForChannelMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {},
}));

vi.mock('@/lib/platform/registry', () => ({
  getAdapterForChannel: getAdapterForChannelMock,
}));

vi.mock('@/lib/platform/connections', () => ({
  getConnectionForChannel: getConnectionForChannelMock,
}));

vi.mock('@/lib/public-api/webhooks', () => ({
  enqueueWebhookEvent: vi.fn(),
}));

describe('publishPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('routes TikTok user_review requests through the platform inbox handoff', async () => {
    const publishMock = vi.fn().mockResolvedValue({
      success: true,
      reviewRequired: true,
      externalId: 'publish_abc',
      externalUrl: 'https://www.tiktok.com/messages?lang=en',
      nextAction: 'open_tiktok_inbox_and_complete_editing',
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
      deliveryMode: 'user_review',
    });

    expect(result).toEqual({
      success: true,
      reviewRequired: true,
      externalId: 'publish_abc',
      externalUrl: 'https://www.tiktok.com/messages?lang=en',
      nextAction: 'open_tiktok_inbox_and_complete_editing',
    });
    expect(getConnectionForChannelMock).toHaveBeenCalledWith('ws_123', 'tiktok', undefined, undefined);
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it('pushes TikTok posts to the adapter when deliveryMode is direct_publish (UI Publish click)', async () => {
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
      deliveryMode: 'direct_publish',
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
  });

  it('publishes each explicit target channel without auto-expanding Meta destinations', async () => {
    const publishByChannel = {
      facebook: vi.fn().mockResolvedValue({
        success: true,
        externalId: 'fb_123',
        externalUrl: 'https://facebook.example/fb_123',
      }),
      linkedin: vi.fn().mockResolvedValue({
        success: true,
        externalId: 'li_123',
        externalUrl: 'https://linkedin.example/li_123',
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
      targetChannels: ['facebook', 'linkedin'],
      mediaUrls: [],
    });

    expect(result.success).toBe(true);
    expect(result.channels.map((item) => item.channel)).toEqual(['facebook', 'linkedin']);
    expect(getConnectionForChannelMock).toHaveBeenCalledWith('ws_123', 'facebook', 'prod_123', undefined);
    expect(getConnectionForChannelMock).toHaveBeenCalledWith('ws_123', 'linkedin', 'prod_123', undefined);
    expect(publishByChannel.facebook).toHaveBeenCalledTimes(1);
    expect(publishByChannel.linkedin).toHaveBeenCalledTimes(1);
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
});
