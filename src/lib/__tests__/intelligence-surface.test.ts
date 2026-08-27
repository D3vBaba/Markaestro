import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {}, getGoogleAccessToken: vi.fn() }));

import { computeReadiness } from '@/lib/intelligence/readiness';
import { comparablePlatforms, generateOpportunities } from '@/lib/intelligence/opportunities';
import { recommendPostingWindows } from '@/lib/intelligence/timing';
import { engagementRate, fingerprintSummaryFromPost, rollupSocialPosts } from '@/lib/intelligence/overview-metrics';
import { generateBrandLearnings } from '@/lib/intelligence/learnings';
import { buildProductInsights } from '@/lib/intelligence/insights';
import { needsFingerprint, selectFingerprintPhase, FINGERPRINT_DAILY_CAP } from '@/lib/intelligence/published-post-fingerprints';
import { fingerprintStorageSummary } from '@/lib/intelligence/fingerprints';
import { buildDraftBrief, composeDraftContent, resolveDraftPlatform, sanitizeGeneratedCopy } from '@/lib/intelligence/drafts';
import { buildExplanationContext } from '@/lib/intelligence/explanations';
import { INSIGHTS_CACHE_VERSION, isInsightsCacheFresh } from '@/lib/intelligence/product-state';
import { platformComparisons, strategistPostRows } from '@/lib/intelligence/strategist-evidence';
import { objectiveMetricFamily } from '@/lib/intelligence/historical-fit';
import { defaultAudienceProfile } from '@/lib/intelligence/schemas';

function post(id: string, platform: string, views: number | null, extra: Record<string, unknown> = {}) {
  return { id, platform, publishedAt: '2026-08-04T15:00:00Z', content: `Caption ${id}`, latestMetrics: { views, likes: views === null ? null : Math.round(views / 10) }, ...extra };
}

function twoPlatformPosts() {
  return [
    ...Array.from({ length: 20 }, (_, index) => post(`ig${index}`, 'instagram', 100)),
    ...Array.from({ length: 5 }, (_, index) => post(`tt${index}`, 'tiktok', 200)),
  ];
}

describe('per-post platform comparison', () => {
  it('ranks by average per post, not total volume', () => {
    const ranked = comparablePlatforms([
      { platform: 'instagram', posts: 20, views: 2000, engagements: 200, measuredViews: 20, measuredEngagements: 20, avgViews: 100, avgEngagements: 10, engagementRate: 0.1 },
      { platform: 'tiktok', posts: 5, views: 1000, engagements: 100, measuredViews: 5, measuredEngagements: 5, avgViews: 200, avgEngagements: 20, engagementRate: 0.1 },
    ]);
    expect(ranked[0]?.platform).toBe('tiktok');
    expect(ranked[0]?.perPost).toBe(200);
  });

  it('ignores platforms with fewer than five measured posts and falls back to engagements', () => {
    const ranked = comparablePlatforms([
      { platform: 'instagram', posts: 20, views: null, engagements: 200, measuredViews: 0, measuredEngagements: 20, avgViews: null, avgEngagements: 10 },
      { platform: 'tiktok', posts: 3, views: 900, engagements: 90, measuredViews: 3, measuredEngagements: 3, avgViews: 300, avgEngagements: 30 },
      { platform: 'linkedin', posts: 8, views: null, engagements: 40, measuredViews: 0, measuredEngagements: 8, avgViews: null, avgEngagements: 5 },
    ]);
    expect(ranked.map((row) => row.platform)).toEqual(['instagram', 'linkedin']);
    expect(ranked[0]?.metric).toBe('engagements');
  });

  it('emits structured params the client can localize', () => {
    const insights = buildProductInsights({ productId: 'brand', profile: null, posts: twoPlatformPosts(), snapshots: [] });
    const platform = insights.opportunities.find((item) => item.kind === 'platform');
    expect(platform?.params.kind).toBe('platform');
    if (platform?.params.kind === 'platform') {
      expect(platform.params.leader).toBe('tiktok');
      expect(platform.params.trailing).toBe('instagram');
      expect(platform.params.leaderPerPost).toBe(200);
      expect(platform.params.leaderPosts).toBe(5);
    }
  });

  it('still compares legacy channel rows without measured counts', () => {
    const opportunities = generateOpportunities({
      productId: 'brand',
      timing: { accountSpecific: false, sampleSize: 0, datedPosts: 0, metric: 'views', timeZone: 'UTC', accountMean: null, windows: [], limitations: ['needs_dated_posts'] },
      channels: [
        { platform: 'instagram', posts: 10, views: 100, engagements: 8 },
        { platform: 'tiktok', posts: 10, views: 20, engagements: 2 },
      ],
      learnings: [],
      alignmentScore: null,
      alignmentCoverage: 0,
    });
    expect(opportunities.some((item) => item.kind === 'platform')).toBe(true);
  });
});

describe('timing windows', () => {
  it('reports lift versus the account mean, the timezone, and machine-readable limitations', () => {
    const posts = [
      ...Array.from({ length: 5 }, (_, index) => post(`am${index}`, 'instagram', 40, { publishedAt: '2026-08-25T15:00:00Z' })),
      ...Array.from({ length: 15 }, (_, index) => post(`pm${index}`, 'instagram', 10, { publishedAt: '2026-08-25T18:00:00Z' })),
    ];
    const timing = recommendPostingWindows({ posts, timeZone: 'Europe/Paris', objective: 'awareness' });
    expect(timing.timeZone).toBe('Europe/Paris');
    expect(timing.metric).toBe('views');
    expect(timing.accountMean).toBeCloseTo(17.5, 5);
    expect(timing.windows[0]?.liftPercent).toBeGreaterThan(0);
    expect(timing.limitations).toEqual([]);

    const few = recommendPostingWindows({ posts: posts.slice(0, 6), timeZone: 'UTC', objective: 'awareness' });
    expect(few.limitations).toEqual(['needs_dated_posts']);
    expect(few.datedPosts).toBe(6);
  });
});

describe('objective metric family', () => {
  it('names the metric people see, not the objective key', () => {
    expect(objectiveMetricFamily('awareness', [post('a', 'instagram', 10)])).toBe('views');
    expect(objectiveMetricFamily('awareness', [{ latestMetrics: { reach: 5 } }])).toBe('reach');
    expect(objectiveMetricFamily('engagement')).toBe('engagements');
    expect(objectiveMetricFamily('website_traffic')).toBe('clicks');
    expect(objectiveMetricFamily('other')).toBe('conversions');
    expect(objectiveMetricFamily('purchases')).toBe('purchases');
  });
});

describe('rollups', () => {
  it('adds per-post averages, engagement rate, and a compact fingerprint summary', () => {
    const result = rollupSocialPosts([
      { id: 'a', platform: 'tiktok', latestMetrics: { views: 100, likes: 5, comments: 5 }, fingerprint: { kind: 'caption', pillar: 'education', hook: 'Stop doing this', topics: ['a', 'b'], evidence: [{ field: 'x', evidence: 'y' }] } },
      { id: 'b', platform: 'tiktok', latestMetrics: { views: 300, likes: null } },
      { id: 'c', platform: 'tiktok', latestMetrics: {} },
    ]);
    const tiktok = result.channels[0]!;
    expect(tiktok.measuredViews).toBe(2);
    expect(tiktok.avgViews).toBe(200);
    expect(tiktok.measuredEngagements).toBe(1);
    expect(tiktok.engagementRate).toBe(0.1);
    expect(result.topContent.find((row) => row.id === 'a')?.fingerprint).toEqual({
      kind: 'caption', pillar: 'education', hook: 'Stop doing this', topics: ['a', 'b'], cta: null, sentiment: null, structure: [], openingStyle: null,
    });
    expect(result.topContent.find((row) => row.id === 'b')?.engagementRate).toBeNull();
    expect(fingerprintSummaryFromPost(null)).toBeNull();
    expect(engagementRate(5, 0)).toBeNull();
  });
});

describe('learnings', () => {
  it('exposes group and rest means with the metric family', () => {
    const learnings = generateBrandLearnings({ productId: 'brand', posts: twoPlatformPosts(), timeZone: 'UTC', objective: 'awareness' });
    const tiktok = learnings.find((item) => item.key === 'tiktok');
    expect(tiktok?.metric).toBe('views');
    expect(tiktok?.groupMean).toBe(200);
    expect(tiktok?.restMean).toBe(100);
    expect(tiktok?.controlObservations).toBe(20);
    expect(tiktok?.effectPercent).toBe(100);
  });

  it('detects content-pattern learnings only when fingerprints exist', () => {
    const posts = [
      ...Array.from({ length: 6 }, (_, index) => post(`edu${index}`, 'instagram', 50, { fingerprint: { pillar: 'education', hook: 'x', kind: 'caption' } })),
      ...Array.from({ length: 6 }, (_, index) => post(`fun${index}`, 'instagram', 10, { fingerprint: { pillar: 'entertainment', hook: null, kind: 'caption' } })),
    ];
    const learnings = generateBrandLearnings({ productId: 'brand', posts, timeZone: 'UTC', objective: 'awareness' });
    expect(learnings.some((item) => item.dimension === 'pillar' && item.key === 'education')).toBe(true);
    expect(learnings.some((item) => item.dimension === 'hook' && item.key === 'has_hook')).toBe(true);
    const bare = generateBrandLearnings({ productId: 'brand', posts: posts.map((item) => ({ ...item, fingerprint: null })), timeZone: 'UTC' });
    expect(bare.some((item) => item.dimension === 'pillar')).toBe(false);
  });
});

describe('readiness', () => {
  it('reports progress toward every threshold and flags unavailable inputs', () => {
    const rollup = rollupSocialPosts([post('a', 'instagram', 10), post('b', 'instagram', 20), post('c', 'instagram', null)]);
    const readiness = computeReadiness({
      posts: [post('a', 'instagram', 10), post('b', 'instagram', 20), post('c', 'instagram', null)],
      channels: rollup.channels,
      measured: rollup.measured,
      coverage: rollup.coverage,
      timeZone: 'UTC',
      objective: 'awareness',
      alignmentAvailable: false,
    });
    expect(readiness.postsTotal).toBe(3);
    expect(readiness.postsMeasured).toBe(2);
    expect(readiness.objectiveMeasured).toBe(2);
    const history = readiness.checks.find((check) => check.id === 'history');
    expect(history).toMatchObject({ met: false, current: 2, required: 5, available: true });
    const timing = readiness.checks.find((check) => check.id === 'timing');
    expect(timing).toMatchObject({ met: false, current: 3, required: 20 });
    expect(readiness.checks.find((check) => check.id === 'alignment')?.available).toBe(false);
    expect(readiness.metrics.views).toEqual({ measured: 2, coverage: 67 });
  });

  it('marks checks met once the data exists', () => {
    const posts = twoPlatformPosts();
    const insights = buildProductInsights({ productId: 'brand', profile: null, posts, snapshots: [] });
    const byId = Object.fromEntries(insights.readiness.checks.map((check) => [check.id, check]));
    expect(byId.history?.met).toBe(true);
    expect(byId.timing?.met).toBe(true);
    expect(byId.platformComparison?.met).toBe(true);
    expect(byId.learnings?.met).toBe(true);
    expect(byId.contentPatterns?.met).toBe(false);
    expect(insights.objective).toEqual({ objective: 'awareness', metric: 'views', requested: 'awareness', fallback: false });
    expect(insights.rollup.topContent[0]?.objectiveValue).toBe(200);
  });
});

describe('objective fallback', () => {
  it('falls back to awareness when no post reports the declared metric, and says so', () => {
    const insights = buildProductInsights({
      productId: 'brand',
      profile: defaultAudienceProfile({ objective: 'app_installs' }),
      posts: twoPlatformPosts(),
      snapshots: [],
    });
    expect(insights.objective).toEqual({ objective: 'awareness', metric: 'views', requested: 'app_installs', fallback: true });
    expect(insights.timing.windows.length).toBeGreaterThan(0);
    expect(insights.rollup.topContent[0]?.objectiveValue).toBe(200);
    const readiness = insights.readiness.checks.find((check) => check.id === 'timing');
    expect(readiness?.met).toBe(true);
  });

  it('keeps the declared objective when it is measured', () => {
    const insights = buildProductInsights({
      productId: 'brand',
      profile: defaultAudienceProfile({ objective: 'engagement' }),
      posts: twoPlatformPosts(),
      snapshots: [],
    });
    expect(insights.objective.fallback).toBe(false);
    expect(insights.objective.metric).toBe('engagements');
  });
});

describe('published post fingerprint backfill', () => {
  it('walks recent, older, then hourly incremental passes and honors the daily cap', () => {
    const now = '2026-08-27T12:00:00.000Z';
    expect(selectFingerprintPhase({}, now)).toBe('recent');
    expect(selectFingerprintPhase({ fingerprintRecentDoneAt: now }, now)).toBe('older');
    expect(selectFingerprintPhase({ fingerprintRecentDoneAt: now, fingerprintOlderDoneAt: now }, now)).toBe('incremental');
    expect(selectFingerprintPhase({ fingerprintRecentDoneAt: now, fingerprintOlderDoneAt: now, fingerprintIncrementalAt: '2026-08-27T11:30:00.000Z' }, now)).toBe('idle');
    expect(selectFingerprintPhase({ fingerprintDailyDate: '2026-08-27', fingerprintDailyCount: FINGERPRINT_DAILY_CAP }, now)).toBe('capped');
    expect(selectFingerprintPhase({ fingerprintDailyDate: '2026-08-26', fingerprintDailyCount: FINGERPRINT_DAILY_CAP }, now)).toBe('recent');
  });

  it('queues only posts with a caption, a brand, and no fingerprint yet', () => {
    expect(needsFingerprint({ productId: 'p', content: 'Hello' })).toBe('queue');
    expect(needsFingerprint({ productId: 'p', content: '   ' })).toBe('skip');
    expect(needsFingerprint({ productId: null, content: 'Hello' })).toBe('skip');
    expect(needsFingerprint({ productId: 'p', content: 'Hello', fingerprint: { kind: 'caption' } })).toBe('skip');
    expect(needsFingerprint({ productId: 'p', content: 'Hello', fingerprintQueuedAt: '2026-08-27T00:00:00Z' })).toBe('skip');
  });

  it('stores a compact summary without evidence or transcripts', () => {
    const summary = fingerprintStorageSummary({
      kind: 'caption',
      schemaVersion: 1,
      topics: Array.from({ length: 12 }, (_, index) => `topic${index}`),
      pillar: 'education',
      cta: 'Save this',
      keywords: Array.from({ length: 30 }, (_, index) => `k${index}`),
      sentiment: 'positive',
      structure: ['hook', 'list', 'cta'],
      productPresence: true,
      humanPresence: false,
      confidence: 0.8,
      evidence: [{ field: 'hook', evidence: 'first line' }],
      hook: 'Stop scrolling',
      openingStyle: 'question',
      conversationPotential: 50,
      professionalValue: 40,
      searchEvergreenFit: 30,
      wordCount: 42,
      hashtags: Array.from({ length: 20 }, (_, index) => `#tag${index}`),
    });
    expect(summary.kind).toBe('caption');
    expect(summary.pillar).toBe('education');
    expect((summary.topics as string[]).length).toBe(8);
    expect((summary.hashtags as string[]).length).toBe(15);
    expect(summary).not.toHaveProperty('evidence');
    expect(summary).not.toHaveProperty('transcript');
  });
});

describe('draft this', () => {
  it('sanitizes generated copy and composes hashtags once', () => {
    expect(sanitizeGeneratedCopy('Fast — simple – done')).toBe('Fast, simple, done');
    expect(composeDraftContent('Hello world', ['#one', 'two', 'two'])).toBe('Hello world\n\n#one #two');
    expect(composeDraftContent('Hello #one', ['one'])).toBe('Hello #one');
  });

  it('builds a brief from the opportunity evidence on the leading platform', () => {
    const insights = buildProductInsights({ productId: 'brand', profile: null, posts: twoPlatformPosts(), snapshots: [] });
    const opportunity = insights.opportunities.find((item) => item.kind === 'platform')!;
    const brief = buildDraftBrief({
      request: { productId: 'brand', source: { type: 'opportunity', id: opportunity.id }, locale: 'fr' },
      insights,
      brand: { name: 'Acme', description: 'Coffee', url: '', voice: { tone: 'warm' } },
    });
    expect(brief.platform).toBe('tiktok');
    expect(brief.language).toBe('fr');
    expect(brief.evidence.length).toBeLessThanOrEqual(5);
    expect(brief.evidence.every((item) => item.platform === 'tiktok')).toBe(true);
    expect(brief.source.type).toBe('opportunity');
    expect(brief.audience.metric).toBe('views');
  });

  it('uses only the source post when remixing one post', () => {
    const insights = buildProductInsights({ productId: 'brand', profile: null, posts: twoPlatformPosts(), snapshots: [] });
    const sourcePost = { id: 'ig1', platform: 'instagram', content: 'Caption ig1', publishedAt: null, views: 100, engagements: 10, engagementRate: 0.1, objectiveValue: 100, fingerprint: null };
    const brief = buildDraftBrief({
      request: { productId: 'brand', source: { type: 'post', id: 'ig1' } },
      insights,
      brand: { name: 'Acme', description: '', url: '', voice: null },
      sourcePost,
    });
    expect(brief.evidence).toEqual([{ ...sourcePost, label: 'Evidence 1 (instagram)' }]);
    expect(brief.platform).toBe('instagram');
    expect(() => buildDraftBrief({
      request: { productId: 'brand', source: { type: 'learning', id: 'missing' } },
      insights,
      brand: { name: 'Acme', description: '', url: '', voice: null },
    })).toThrow('NOT_FOUND');
  });

  it('falls back through platform priority and measured channels', () => {
    const profile = defaultAudienceProfile({ platformPriorities: [{ platform: 'linkedin', priority: 1 }] });
    expect(resolveDraftPlatform({
      source: { type: 'post', postId: 'x' },
      evidence: [],
      profile,
      channels: [{ platform: 'threads' }],
    })).toBe('linkedin');
    expect(resolveDraftPlatform({
      requested: 'pinterest',
      source: { type: 'post', postId: 'x' },
      evidence: [],
      profile,
      channels: [],
    })).toBe('pinterest');
    expect(resolveDraftPlatform({
      source: { type: 'post', postId: 'x' },
      evidence: [],
      profile: defaultAudienceProfile(),
      channels: [{ platform: 'unknown' }],
    })).toBe('instagram');
  });
});

describe('why it worked', () => {
  it('ranks the post among measured posts and includes the platform average', () => {
    const insights = buildProductInsights({ productId: 'brand', profile: null, posts: twoPlatformPosts(), snapshots: [] });
    const context = buildExplanationContext({ postId: 'ig3', insights, locale: 'de' });
    expect(context?.language).toBe('de');
    expect(context?.post.platform).toBe('instagram');
    expect(context?.account.platformAverage?.views).toBe(100);
    expect(context?.account.rankAmongMeasured?.of).toBe(25);
    expect(context?.account.rankAmongMeasured?.position).toBeGreaterThan(5);
    expect(buildExplanationContext({ postId: 'missing', insights })).toBeNull();
  });
});

describe('insights cache', () => {
  it('is fresh only for the current version inside the ttl', () => {
    const now = Date.parse('2026-08-27T12:00:00Z');
    const base = { cacheVersion: INSIGHTS_CACHE_VERSION, computedAt: '2026-08-27T11:30:00Z', insights: {} as never };
    expect(isInsightsCacheFresh(base, now)).toBe(true);
    expect(isInsightsCacheFresh({ ...base, computedAt: '2026-08-27T10:30:00Z' }, now)).toBe(false);
    expect(isInsightsCacheFresh({ ...base, cacheVersion: INSIGHTS_CACHE_VERSION - 1 }, now)).toBe(false);
    expect(isInsightsCacheFresh(undefined, now)).toBe(false);
  });
});

describe('strategist evidence', () => {
  it('adds per-post means to platform comparisons', () => {
    const rows = strategistPostRows([
      { id: 'a', platform: 'tiktok', latestMetrics: { views: 10, likes: 2 } },
      { id: 'b', platform: 'tiktok', latestMetrics: { views: 30, likes: null } },
      { id: 'c', platform: 'tiktok', latestMetrics: {} },
    ]);
    const comparison = platformComparisons(rows)[0]!;
    expect(comparison.measuredViews).toBe(2);
    expect(comparison.viewsPerPost).toBe(20);
    expect(comparison.engagementsPerPost).toBe(2);
  });
});
