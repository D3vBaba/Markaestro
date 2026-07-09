import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAdapterForChannelMock = vi.fn();
const getConnectionForChannelMock = vi.fn();
const getLinkedInConnectionForDestinationMock = vi.fn();
const enqueueWebhookEventMock = vi.fn();
const docUpdateMock = vi.fn();
const docMock = vi.fn((path: string) => {
  void path;
  return { update: docUpdateMock };
});

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: (path: string) => docMock(path),
  },
}));

vi.mock('@/lib/platform/registry', () => ({
  getAdapterForChannel: getAdapterForChannelMock,
}));

vi.mock('@/lib/platform/connections', () => ({
  getConnectionForChannel: getConnectionForChannelMock,
  getLinkedInConnectionForDestination: getLinkedInConnectionForDestinationMock,
  markConnectionAuthError: vi.fn(),
}));

vi.mock('@/lib/public-api/webhooks', () => ({
  enqueueWebhookEvent: enqueueWebhookEventMock,
}));

describe('manual reminder publishing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishPost never touches adapters or connections for manual reminder requests', async () => {
    const { publishPost } = await import('../social/publisher');

    const result = await publishPost('ws_123', 'prod_123', {
      channel: 'instagram',
      content: 'Demo',
      mediaUrls: ['https://example.com/image.jpg'],
      deliveryMode: 'manual_reminder',
    });

    expect(result.success).toBe(false);
    expect(result.actionRequired).toBe(true);
    expect(result.nextAction).toBe('post_manually_from_reminder');
    expect(getAdapterForChannelMock).not.toHaveBeenCalled();
    expect(getConnectionForChannelMock).not.toHaveBeenCalled();
  });

  it('publishStoredPost routes manual reminder posts to the manual queue without a product or connection', async () => {
    const { publishStoredPost } = await import('../social/publisher');

    const result = await publishStoredPost('ws_123', undefined, {
      channel: 'facebook',
      content: 'Demo',
      mediaUrls: [],
      deliveryMode: 'manual_reminder',
    });

    expect(result.success).toBe(false);
    expect(result.actionRequired).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.channels).toEqual([
      { channel: 'facebook', success: false, actionRequired: true, nextAction: 'post_manually_from_reminder' },
    ]);
    expect(getAdapterForChannelMock).not.toHaveBeenCalled();
    expect(getConnectionForChannelMock).not.toHaveBeenCalled();
    expect(getLinkedInConnectionForDestinationMock).not.toHaveBeenCalled();
  });

  it('covers every target channel on multi-channel manual reminder posts', async () => {
    const { publishStoredPost } = await import('../social/publisher');

    const result = await publishStoredPost('ws_123', undefined, {
      channel: 'instagram',
      targetChannels: ['instagram', 'tiktok'],
      content: 'Demo',
      mediaUrls: ['https://example.com/videos/demo.mp4'],
      deliveryMode: 'manual_reminder',
    });

    expect(result.actionRequired).toBe(true);
    expect(result.channels.map((channel) => channel.channel)).toEqual(['instagram', 'tiktok']);
    expect(result.channels.every((channel) => channel.actionRequired)).toBe(true);
    expect(getAdapterForChannelMock).not.toHaveBeenCalled();
  });

  it('finalizeManualReminderPublish moves API posts to platform_action_required and notifies the client', async () => {
    const { finalizeManualReminderPublish, publishStoredPost } = await import('../social/publisher');

    const post = {
      channel: 'instagram',
      content: 'Demo',
      deliveryMode: 'manual_reminder',
      createdByType: 'api_client',
    };
    const result = await publishStoredPost('ws_123', undefined, post);
    const outcome = await finalizeManualReminderPublish('ws_123', {
      postId: 'post_1',
      post,
      attemptId: 'attempt_1',
      attemptCount: 1,
    }, result);

    expect(outcome).toBe('action_required');
    expect(docMock).toHaveBeenCalledWith('workspaces/ws_123/posts/post_1');
    expect(docUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'platform_action_required',
      nextAction: 'post_manually_from_reminder',
      publishLeaseExpiresAt: null,
      nextRetryAt: null,
    }));
    expect(enqueueWebhookEventMock).toHaveBeenCalledWith('ws_123', 'post.action_required', expect.objectContaining({
      postId: 'post_1',
      status: 'platform_action_required',
      nextAction: 'post_manually_from_reminder',
    }));
  });

  it('finalizeManualReminderPublish skips the webhook for posts not created by an API client', async () => {
    const { finalizeManualReminderPublish, publishStoredPost } = await import('../social/publisher');

    const post = {
      channel: 'facebook',
      content: 'Demo',
      deliveryMode: 'manual_reminder',
      createdByType: 'user',
    };
    const result = await publishStoredPost('ws_123', undefined, post);
    const outcome = await finalizeManualReminderPublish('ws_123', {
      postId: 'post_2',
      post,
      attemptId: 'attempt_1',
      attemptCount: 1,
    }, result);

    expect(outcome).toBe('action_required');
    expect(docUpdateMock).toHaveBeenCalledTimes(1);
    expect(enqueueWebhookEventMock).not.toHaveBeenCalled();
  });

  it('re-exports the shared status constants from the TikTok draft flow unchanged', async () => {
    const manualFlow = await import('../manual-publish-flow');
    const tiktokFlow = await import('../tiktok-draft-flow');

    expect(tiktokFlow.PLATFORM_ACTION_REQUIRED_STATUS).toBe(manualFlow.PLATFORM_ACTION_REQUIRED_STATUS);
    expect(tiktokFlow.LEGACY_EXPORTED_FOR_REVIEW_STATUS).toBe(manualFlow.LEGACY_EXPORTED_FOR_REVIEW_STATUS);
    expect(tiktokFlow.isPlatformActionRequiredStatus('platform_action_required')).toBe(true);
    expect(tiktokFlow.isPlatformActionRequiredStatus('exported_for_review')).toBe(true);
  });

  it('identifies manual reminder posts by delivery mode only', async () => {
    const { isManualReminderPost, isManualReminderDeliveryMode } = await import('../manual-publish-flow');

    expect(isManualReminderPost({ deliveryMode: 'manual_reminder' })).toBe(true);
    expect(isManualReminderPost({ deliveryMode: 'direct_publish' })).toBe(false);
    expect(isManualReminderPost({ deliveryMode: 'platform_inbox' })).toBe(false);
    expect(isManualReminderPost({})).toBe(false);
    expect(isManualReminderDeliveryMode('manual_reminder')).toBe(true);
  });
});
