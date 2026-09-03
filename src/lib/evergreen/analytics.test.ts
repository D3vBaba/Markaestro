import { describe, expect, it } from 'vitest';
import { combineEvergreenMetricTotals, evergreenMetricTotals } from './analytics';

describe('evergreen analytics', () => {
  it('preserves unavailable metrics as null while summing measured values', () => {
    expect(evergreenMetricTotals({
      x: { views: 120, reach: null, likes: 4, comments: 2, shares: 1, saves: null, clicks: 3 },
      threads: { views: null, reach: null, likes: null, comments: null, shares: null, saves: null, clicks: null },
    })).toEqual({ views: 120, reach: null, engagements: 7, platformClicks: 3 });
  });

  it('does not turn an unavailable lifetime metric into zero', () => {
    expect(combineEvergreenMetricTotals([
      { views: null, reach: null, engagements: 3, platformClicks: null },
      { views: null, reach: null, engagements: 2, platformClicks: null },
    ])).toEqual({ views: null, reach: null, engagements: 5, platformClicks: null });
  });
});
