import { describe, expect, it } from 'vitest';
import { rollupSocialPosts, sumMeasured } from '@/lib/intelligence/overview-metrics';

describe('overview metric rollups', () => {
  it('never treats missing metrics as zero', () => {
    const result = rollupSocialPosts([
      { id: 'a', platform: 'tiktok', latestMetrics: { views: 10, likes: 2 } },
      { id: 'b', platform: 'tiktok', latestMetrics: { views: null, likes: null, reach: null } },
      { id: 'c', platform: 'instagram', latestMetrics: {} },
    ]);
    expect(result.totals.views).toBe(10);
    expect(result.measured.views).toBe(1);
    expect(result.coverage.views).toBe(33);
    expect(result.totals.reach).toBeNull();
    expect(result.channels.find((channel) => channel.platform === 'instagram')?.views).toBeNull();
    expect(result.topContent[1].views).toBeNull();
  });

  it('sums only returned engagement parts', () => {
    expect(sumMeasured([null, undefined, 4])).toBe(4);
    expect(sumMeasured([null, null])).toBeNull();
  });

  it('extracts username from permalink and surfaces per-post engagement metrics', () => {
    const result = rollupSocialPosts([
      {
        id: 'a',
        platform: 'tiktok',
        permalink: 'https://www.tiktok.com/@skyyn.app/video/123',
        latestMetrics: { views: 853, likes: 12, comments: 3, shares: 1 },
      },
    ]);
    expect(result.topContent[0]?.username).toBe('skyyn.app');
    expect(result.topContent[0]?.likes).toBe(12);
    expect(result.topContent[0]?.comments).toBe(3);
    expect(result.topContent[0]?.shares).toBe(1);
  });
});
