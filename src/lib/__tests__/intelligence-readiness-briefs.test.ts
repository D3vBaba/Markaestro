import { describe, expect, it } from 'vitest';
import { buildProductInsights } from '@/lib/intelligence/insights';
import { defaultAudienceProfile } from '@/lib/intelligence/schemas';
import { composeDraftContent, resolveDraftPlatform, sanitizeGeneratedCopy } from '@/lib/intelligence/drafts';
import { buildExplanationContext } from '@/lib/intelligence/explanations';
import { groupedPerformance, strategistPostRows, timingPerformance } from '@/lib/intelligence/strategist-evidence';
import { generateOpportunities } from '@/lib/intelligence/opportunities';
import { recommendPostingWindows, TIMING_MIN_DATED_POSTS, TIMING_MIN_WINDOW_OBSERVATIONS } from '@/lib/intelligence/timing';
import { HISTORY_MIN_MEASURED } from '@/lib/intelligence/readiness';

function post(id: string, views: number | null, publishedAt: string, extra: Record<string, unknown> = {}) {
  return { id, publishedAt, latestMetrics: { views }, platform: 'instagram', content: `caption ${id}`, ...extra };
}

function insightsFor(posts: ReturnType<typeof post>[]) {
  return buildProductInsights({
    productId: 'brand',
    profile: defaultAudienceProfile({ objective: 'awareness' }),
    posts,
    snapshots: [],
  });
}

const check = (insights: ReturnType<typeof insightsFor>, id: string) => insights.readiness.checks.find((item) => item.id === id)!;

describe('readiness thresholds', () => {
  it('flips the history check exactly at five measured posts, never before', () => {
    const four = insightsFor(Array.from({ length: 4 }, (_, i) => post(`p${i}`, 10, '2026-08-01T12:00:00Z')));
    expect(check(four, 'history')).toMatchObject({ met: false, current: 4, required: HISTORY_MIN_MEASURED });
    const five = insightsFor(Array.from({ length: 5 }, (_, i) => post(`p${i}`, 10, '2026-08-01T12:00:00Z')));
    expect(check(five, 'history').met).toBe(true);
  });

  it('does not count posts with blank metrics as measured', () => {
    const insights = insightsFor([
      ...Array.from({ length: 5 }, (_, i) => post(`blank${i}`, null, '2026-08-01T12:00:00Z')),
      post('measured', 10, '2026-08-01T12:00:00Z'),
    ]);
    expect(check(insights, 'history')).toMatchObject({ met: false, current: 1 });
    expect(insights.readiness.postsMeasured).toBe(1);
  });

  it('shows the binding timing condition: dated posts first, then measured observations', () => {
    const undated = insightsFor(Array.from({ length: 25 }, (_, i) => post(`p${i}`, 10, '')));
    expect(check(undated, 'timing')).toMatchObject({ met: false, required: TIMING_MIN_DATED_POSTS, current: 0 });
    const datedButUnmeasured = insightsFor([
      ...Array.from({ length: 22 }, (_, i) => post(`d${i}`, null, '2026-08-01T12:00:00Z')),
      ...Array.from({ length: 3 }, (_, i) => post(`m${i}`, 10, '2026-08-01T12:00:00Z')),
    ]);
    expect(check(datedButUnmeasured, 'timing')).toMatchObject({ met: false, required: TIMING_MIN_WINDOW_OBSERVATIONS, current: 3 });
  });

  it('needs two platforms with five measured posts each before comparing them', () => {
    const one = insightsFor(Array.from({ length: 6 }, (_, i) => post(`ig${i}`, 10, '2026-08-01T12:00:00Z')));
    expect(check(one, 'platformComparison')).toMatchObject({ met: false, current: 1, required: 2 });
    const two = insightsFor([
      ...Array.from({ length: 5 }, (_, i) => post(`ig${i}`, 10, '2026-08-01T12:00:00Z')),
      ...Array.from({ length: 5 }, (_, i) => post(`tt${i}`, 30, '2026-08-01T12:00:00Z', { platform: 'tiktok' })),
    ]);
    expect(check(two, 'platformComparison').met).toBe(true);
  });

  it('counts analyzed captions toward content patterns and keeps alignment unavailable without demographics', () => {
    const insights = insightsFor([
      ...Array.from({ length: 4 }, (_, i) => post(`f${i}`, 10, '2026-08-01T12:00:00Z', { fingerprint: { pillar: 'education' } })),
      post('plain', 10, '2026-08-01T12:00:00Z'),
    ]);
    expect(check(insights, 'contentPatterns')).toMatchObject({ met: false, current: 4 });
    expect(insights.readiness.fingerprinted).toBe(4);
    expect(check(insights, 'alignment').available).toBe(false);
  });
});

describe('timing edge cases', () => {
  it('switches on at exactly 20 dated posts with a five-post window', () => {
    const posts = [
      ...Array.from({ length: 5 }, (_, i) => post(`win${i}`, 50, '2026-08-25T15:00:00Z')),
      ...Array.from({ length: 15 }, (_, i) => post(`rest${i}`, 10, `2026-08-${String(4 + i).padStart(2, '0')}T09:00:00Z`)),
    ];
    const result = recommendPostingWindows({ posts, timeZone: 'UTC', objective: 'awareness' });
    expect(result.datedPosts).toBe(20);
    expect(result.accountSpecific).toBe(true);
    expect(result.windows[0]?.observations).toBe(5);
    expect(result.windows[0]?.liftPercent).toBeGreaterThan(0);
  });

  it('reports no window when twenty dated posts spread thinner than five per slot', () => {
    const posts = Array.from({ length: 20 }, (_, i) => post(`p${i}`, 10, `2026-08-${String(1 + i).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00Z`));
    const result = recommendPostingWindows({ posts, timeZone: 'UTC', objective: 'awareness' });
    expect(result.windows).toEqual([]);
    expect(result.limitations).toContain('no_window_with_five');
  });
});

describe('opportunities', () => {
  const emptyTiming = { accountSpecific: false, sampleSize: 0, datedPosts: 0, metric: 'views', timeZone: 'UTC', accountMean: null, windows: [], limitations: [] as never[] };
  const channel = (platform: string, measured: number, avgViews: number) => ({
    platform, posts: measured, views: avgViews * measured, engagements: measured, measuredViews: measured, measuredEngagements: measured, avgViews, avgEngagements: 1, engagementRate: 0.01,
  });

  it('compares platforms per post only when both have five measured posts', () => {
    const thin = generateOpportunities({
      productId: 'brand', timing: emptyTiming, learnings: [], alignmentScore: null, alignmentCoverage: 0,
      channels: [channel('instagram', 5, 100), channel('tiktok', 4, 10)],
    });
    expect(thin.filter((item) => item.kind === 'platform')).toEqual([]);
    const ready = generateOpportunities({
      productId: 'brand', timing: emptyTiming, learnings: [], alignmentScore: null, alignmentCoverage: 0,
      channels: [channel('instagram', 5, 100), channel('tiktok', 5, 10)],
    });
    const platform = ready.find((item) => item.kind === 'platform');
    expect(platform?.params).toMatchObject({ kind: 'platform', leader: 'instagram', trailing: 'tiktok', leaderPosts: 5, trailingPosts: 5 });
  });

  it('never emits an alignment move without a measured score', () => {
    const none = generateOpportunities({
      productId: 'brand', timing: emptyTiming, learnings: [], alignmentScore: null, alignmentCoverage: 0, channels: [],
      weakestAlignmentDimension: { dimension: 'geography', score: 20 },
    });
    expect(none.filter((item) => item.kind === 'alignment')).toEqual([]);
  });
});

describe('draft helpers', () => {
  it('strips dashes the copy rules forbid and tidies whitespace', () => {
    expect(sanitizeGeneratedCopy('Fresh drop — today only  \n\n\n\nLink below')).toBe('Fresh drop, today only\n\nLink below');
  });

  it('appends deduplicated hashtags only when the caption lacks them', () => {
    expect(composeDraftContent('Hello', ['#one', 'one', 'two words'])).toBe('Hello\n\n#one #twowords');
    expect(composeDraftContent('Hello #one', ['one'])).toBe('Hello #one');
  });

  it('resolves the draft platform in a fixed order of precedence', () => {
    const profile = { platformPriorities: [{ platform: 'linkedin', weight: 100 }] } as never;
    const base = { evidence: [], profile, channels: [{ platform: 'threads' }] };
    const learning = { type: 'learning' as const, id: 'l', dimension: 'platform', key: 'tiktok' } as never;
    expect(resolveDraftPlatform({ ...base, requested: 'pinterest', source: learning })).toBe('pinterest');
    expect(resolveDraftPlatform({ ...base, source: learning })).toBe('tiktok');
    const opportunity = { type: 'opportunity' as const, id: 'o', params: { kind: 'platform', leader: 'facebook' } } as never;
    expect(resolveDraftPlatform({ ...base, source: opportunity })).toBe('facebook');
    const postSource = { type: 'post' as const, id: 'p' } as never;
    expect(resolveDraftPlatform({ ...base, source: postSource, evidence: [{ platform: 'instagram' } as never] })).toBe('instagram');
    expect(resolveDraftPlatform({ ...base, source: postSource })).toBe('linkedin');
    expect(resolveDraftPlatform({ ...base, source: postSource, profile: { platformPriorities: [] } as never })).toBe('threads');
    expect(resolveDraftPlatform({ ...base, source: postSource, profile: { platformPriorities: [] } as never, channels: [] })).toBe('instagram');
  });
});

describe('explanation context', () => {
  it('ranks the post among measured posts and reports the platform average without inventing numbers', () => {
    const insights = insightsFor([
      post('top', 100, '2026-08-01T12:00:00Z'),
      post('mid', 50, '2026-08-02T12:00:00Z'),
      post('low', 10, '2026-08-03T12:00:00Z'),
      post('blank', null, '2026-08-04T12:00:00Z'),
    ]);
    const context = buildExplanationContext({ postId: 'mid', insights, locale: 'fr' })!;
    expect(context.language).toBe('fr');
    expect(context.account.rankAmongMeasured).toEqual({ position: 2, of: 3 });
    expect(context.post.metrics.views).toBe(50);
    expect(context.account.platformAverage?.measuredPosts).toBe(3);
    expect(context.account.bestWindow).toBeNull();
    expect(context.post.publishedAtLocal).toContain('UTC');
    expect(buildExplanationContext({ postId: 'missing', insights })).toBeNull();
  });
});

describe('strategist evidence grouping', () => {
  it('groups per weekday and hour in the brand timezone and skips undated posts', () => {
    const rows = strategistPostRows([
      { id: 'a', platform: 'instagram', publishedAt: '2026-08-25T15:00:00Z', latestMetrics: { views: 10, likes: 1 } },
      { id: 'b', platform: 'instagram', publishedAt: '2026-08-25T15:30:00Z', latestMetrics: { views: 30 } },
      { id: 'c', platform: 'instagram', publishedAt: null, latestMetrics: { views: 99, likes: 9 } },
    ]);
    const grouped = timingPerformance(rows, 'UTC');
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ id: 'Tue-15', posts: 2, views: 40, viewsPerPost: 20 });
    expect(grouped[0]?.engagements).toBe(1);
  });

  it('drops rows whose key resolves to nothing', () => {
    const rows = strategistPostRows([{ id: 'a', platform: 'instagram', publishedAt: null, latestMetrics: { views: 1 } }]);
    expect(groupedPerformance(rows, () => null)).toEqual([]);
  });
});
