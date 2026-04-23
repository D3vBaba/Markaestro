import { describe, expect, it } from 'vitest';
import { requiresConnectedPublishDestination, resolveQueuedPublishDeliveryMode } from '../public-api/publish-runs';

describe('public API queued publish flow', () => {
  it('forces TikTok queued publishes onto the direct publish path', () => {
    const post = {
      channel: 'tiktok',
      deliveryMode: 'user_review',
    };

    expect(resolveQueuedPublishDeliveryMode(post)).toBe('direct_publish');
    expect(requiresConnectedPublishDestination(post)).toBe(true);
  });

  it('preserves explicit user review only for non-TikTok channels', () => {
    const post = {
      channel: 'facebook',
      deliveryMode: 'user_review',
    };

    expect(resolveQueuedPublishDeliveryMode(post)).toBe('user_review');
    expect(requiresConnectedPublishDestination(post)).toBe(false);
  });
});
