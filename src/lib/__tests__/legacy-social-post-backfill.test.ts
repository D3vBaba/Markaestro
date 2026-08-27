import { describe, expect, it } from 'vitest';
import { emptyMetrics } from '@/lib/platform/base-adapter';
import { metricsForLegacyBackfill, publishedChannelTargets } from '@/lib/intelligence/publish-targets';

describe('publishedChannelTargets', () => {
  it('prefers successful publishResults over the single-channel fields', () => {
    expect(publishedChannelTargets({
      channel: 'instagram',
      externalId: 'ig_old',
      publishResults: [
        { channel: 'facebook', success: true, externalId: 'fb_1' },
        { channel: 'instagram', success: false, externalId: 'ig_fail' },
      ],
    })).toEqual([{ channel: 'facebook', externalId: 'fb_1' }]);
  });

  it('falls back to channel and externalId when publishResults are empty', () => {
    expect(publishedChannelTargets({
      channel: 'tiktok',
      externalId: 'tt_9',
      publishResults: [],
    })).toEqual([{ channel: 'tiktok', externalId: 'tt_9' }]);
  });
});

describe('metricsForLegacyBackfill', () => {
  it('keeps stored metrics and does not fabricate zeros', () => {
    const stored = { ...emptyMetrics(), views: 12, likes: 3, reach: null };
    expect(metricsForLegacyBackfill({ instagram: stored }, 'instagram')).toEqual(stored);
    expect(metricsForLegacyBackfill({ instagram: stored }, 'tiktok')).toEqual(emptyMetrics());
    expect(metricsForLegacyBackfill(undefined, 'facebook').views).toBeNull();
  });
});
