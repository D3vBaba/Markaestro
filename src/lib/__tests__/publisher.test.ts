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

  it('stages TikTok posts in Markaestro when deliveryMode is user_review (public API path)', async () => {
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
      nextAction: 'open_markaestro_drafts_and_post_manually',
    });
    expect(getConnectionForChannelMock).not.toHaveBeenCalled();
    expect(getAdapterForChannelMock).not.toHaveBeenCalled();
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
