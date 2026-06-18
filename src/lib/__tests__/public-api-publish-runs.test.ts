import { describe, expect, it } from 'vitest';
import { requiresConnectedPublishDestination, resolveQueuedPublishDeliveryMode } from '../public-api/publish-runs';

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
});
