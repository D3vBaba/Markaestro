import { describe, expect, it } from 'vitest';
import { getPublishRunSkipReason, requiresConnectedPublishDestination, resolveQueuedPublishDeliveryMode } from '../public-api/publish-runs';

describe('public API queued publish flow', () => {
  it('uses the platform inbox path for TikTok queued publishes', () => {
    const post = {
      channel: 'tiktok',
    };

    expect(resolveQueuedPublishDeliveryMode(post)).toBe('platform_inbox');
    expect(requiresConnectedPublishDestination(post)).toBe(true);
  });

  it('ignores legacy review delivery mode and still requires a connected destination', () => {
    const post = {
      channel: 'facebook',
      deliveryMode: 'legacy_review_mode',
    };

    expect(resolveQueuedPublishDeliveryMode(post)).toBe('direct_publish');
    expect(requiresConnectedPublishDestination(post)).toBe(true);
  });

  it('does not start another publish for posts already in progress or handed off', () => {
    expect(getPublishRunSkipReason({ status: 'publishing', channel: 'tiktok' })).toBe('Post is already publishing');
    expect(getPublishRunSkipReason({ status: 'published', channel: 'facebook' })).toBe('Post is already published');
    expect(getPublishRunSkipReason({ status: 'platform_action_required', channel: 'tiktok' })).toBe('Post is already ready for platform action');
    expect(getPublishRunSkipReason({ status: 'failed', channel: 'tiktok' })).toBeNull();
  });
});
