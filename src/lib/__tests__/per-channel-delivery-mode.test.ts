import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));
vi.mock('@/lib/platform/registry', () => ({ getAdapterForChannel: vi.fn() }));
vi.mock('@/lib/platform/connections', () => ({
  getConnectionForChannel: vi.fn(),
  getLinkedInConnectionForDestination: vi.fn(),
  markConnectionAuthError: vi.fn(),
}));
vi.mock('@/lib/public-api/webhooks', () => ({ enqueueWebhookEvent: vi.fn() }));

/**
 * Per-channel delivery mode (plan item 3.11 / CH-03).
 *
 * The bug: `resolveInAppDeliveryMode` demoted the whole post to
 * `manual_reminder` when *any* target channel was manual, so a user who set
 * Instagram to manual and composed to Instagram plus LinkedIn had to post the
 * LinkedIn one by hand too. Delivery mode now belongs to the target.
 */
describe('getPostChannelDeliveryMode', () => {
  it('reads the per-channel map ahead of the post-level fallback', async () => {
    const { getPostChannelDeliveryMode } = await import('../social/publisher');
    const post = {
      deliveryMode: 'manual_reminder',
      channelDeliveryModes: { linkedin: 'direct_publish', instagram: 'manual_reminder' },
    };

    expect(getPostChannelDeliveryMode(post, 'linkedin', undefined)).toBe('direct_publish');
    expect(getPostChannelDeliveryMode(post, 'instagram', undefined)).toBe('manual_reminder');
  });

  it('falls back to the post-level mode for documents written before the map existed', async () => {
    const { getPostChannelDeliveryMode } = await import('../social/publisher');

    // Every post created before 3.11 looks like this. It must keep behaving
    // exactly as it did, or existing manual posts start publishing themselves.
    expect(getPostChannelDeliveryMode({ deliveryMode: 'manual_reminder' }, 'instagram', undefined))
      .toBe('manual_reminder');
    expect(getPostChannelDeliveryMode({}, 'linkedin', undefined)).toBe('direct_publish');
  });

  it('still resolves TikTok inbox versus direct post from the settings', async () => {
    const { getPostChannelDeliveryMode } = await import('../social/publisher');

    expect(getPostChannelDeliveryMode({}, 'tiktok', undefined)).toBe('platform_inbox');
    expect(getPostChannelDeliveryMode({}, 'tiktok', { __type: 'tiktok', postMode: 'direct_post' })).toBe('direct_publish');
  });
});

describe('isFullyManualReminderPost', () => {
  it('is true only when every target is manual', async () => {
    const { isFullyManualReminderPost } = await import('../social/publisher');
    const mixed = {
      channelDeliveryModes: { linkedin: 'direct_publish', instagram: 'manual_reminder' },
    };
    const allManual = {
      channelDeliveryModes: { facebook: 'manual_reminder', instagram: 'manual_reminder' },
    };

    expect(isFullyManualReminderPost(mixed, ['linkedin', 'instagram'])).toBe(false);
    expect(isFullyManualReminderPost(allManual, ['facebook', 'instagram'])).toBe(true);
  });

  it('does not short-circuit a mixed post through the whole-post manual path', async () => {
    const { isFullyManualReminderPost } = await import('../social/publisher');

    // The regression guard: post-level `manual_reminder` used to be enough to
    // skip the adapter pipeline for every channel on the post.
    expect(isFullyManualReminderPost(
      { deliveryMode: 'manual_reminder', channelDeliveryModes: { linkedin: 'direct_publish' } },
      ['linkedin'],
    )).toBe(false);
  });
});
