import { describe, expect, it } from 'vitest';
import { targetDistributionsFromProfile } from '@/lib/intelligence/alignment';
import { detectAudienceDrift, splitSnapshotsByWindow } from '@/lib/intelligence/drift';
import { generateBrandLearnings } from '@/lib/intelligence/learnings';
import { generateOpportunities } from '@/lib/intelligence/opportunities';
import { recommendPostingWindows } from '@/lib/intelligence/timing';
import { platformComparisons, strategistPostRows, topPostsByViews } from '@/lib/intelligence/strategist-evidence';
import { bootstrapMeanDifferencePercent, meanDifferencePercent } from '@/lib/intelligence/statistics';
import { defaultAudienceProfile } from '@/lib/intelligence/schemas';
import { buildProductInsights } from '@/lib/intelligence/insights';
import { appendClickId, conversionSignature, verifyConversionSignature } from '@/lib/intelligence/conversions';

function datedPost(id: string, views: number | null, publishedAt: string, extra: Record<string, unknown> = {}) {
  return { id, publishedAt, latestMetrics: { views }, platform: 'instagram', ...extra };
}

describe('timing windows', () => {
  it('stays unavailable until 20 posts and five observations exist in a window', () => {
    const posts = Array.from({ length: 19 }, (_, index) => datedPost(`p${index}`, 10, '2026-08-25T18:00:00Z'));
    expect(recommendPostingWindows({ posts, timeZone: 'UTC', objective: 'awareness' }).windows).toEqual([]);
  });

  it('ranks account-specific windows from measured values', () => {
    const posts = [
      ...Array.from({ length: 5 }, (_, index) => datedPost(`am${index}`, 40, '2026-08-25T15:00:00Z')),
      ...Array.from({ length: 15 }, (_, index) => datedPost(`pm${index}`, 10, '2026-08-25T18:00:00Z')),
    ];
    const result = recommendPostingWindows({ posts, timeZone: 'UTC', objective: 'awareness' });
    expect(result.accountSpecific).toBe(true);
    expect(result.windows[0]?.bucket).toBe('Tue-15');
    expect(result.windows[0]?.label).toBe('measured');
  });
});

describe('alignment and drift', () => {
  it('builds target geography from the audience profile', () => {
    const profile = defaultAudienceProfile({
      targetMarkets: [
        { code: 'US', label: 'United States', weight: 80, priority: 'primary' },
        { code: 'CA', label: 'Canada', weight: 20, priority: 'secondary' },
      ],
    });
    expect(targetDistributionsFromProfile(profile).geography).toEqual({ us: 80, ca: 20 });
  });

  it('does not alert on drift without coverage and two snapshot windows', () => {
    const profile = defaultAudienceProfile({
      targetMarkets: [
        { code: 'US', label: 'United States', weight: 100, priority: 'primary' },
      ],
    });
    expect(detectAudienceDrift({
      productId: 'brand',
      profile,
      recent: [{ date: '2026-08-24', distributions: { geography: { us: 1 } } }],
      baseline: [{ date: '2026-08-01', distributions: { geography: { us: 1 } } }],
    })).toBeNull();
  });

  it('alerts when alignment drops with confirmed coverage', () => {
    const profile = defaultAudienceProfile({
      targetMarkets: [
        { code: 'US', label: 'United States', weight: 100, priority: 'primary' },
      ],
    });
    const recent = Array.from({ length: 5 }, (_, index) => ({
      date: `2026-08-2${index}`,
      distributions: { geography: { us: 50, ca: 50 } },
    }));
    const baseline = Array.from({ length: 5 }, (_, index) => ({
      date: `2026-08-0${index + 1}`,
      distributions: { geography: { us: 100 } },
    }));
    const event = detectAudienceDrift({ productId: 'brand', profile, recent, baseline });
    expect(event?.alignmentDeclinePoints).toBeGreaterThanOrEqual(10);
    expect(event?.associationOnly).toBe(true);
  });

  it('splits snapshots into 7-day and 28-day windows', () => {
    const now = Date.parse('2026-08-25T00:00:00Z');
    const split = splitSnapshotsByWindow([
      { date: '2026-08-24' },
      { date: '2026-08-10' },
      { date: '2026-07-01' },
    ], now);
    expect(split.recent).toHaveLength(1);
    expect(split.baseline).toHaveLength(1);
  });
});

describe('learnings and opportunities', () => {
  it('requires five measured posts in the group and five in the rest', () => {
    const posts = Array.from({ length: 6 }, (_, index) => datedPost(`ig${index}`, 20, '2026-08-01T12:00:00Z', { platform: 'instagram' }));
    expect(generateBrandLearnings({ productId: 'brand', posts, timeZone: 'UTC' })).toEqual([]);
  });

  it('emits a platform learning with evidence ids and no fabricated zeros', () => {
    const posts = [
      ...Array.from({ length: 5 }, (_, index) => datedPost(`ig${index}`, 50, '2026-08-01T12:00:00Z', { platform: 'instagram' })),
      ...Array.from({ length: 5 }, (_, index) => datedPost(`tt${index}`, 10, '2026-08-01T12:00:00Z', { platform: 'tiktok' })),
      datedPost('gap', null, '2026-08-01T12:00:00Z', { platform: 'tiktok' }),
    ];
    const learnings = generateBrandLearnings({ productId: 'brand', posts, timeZone: 'UTC', objective: 'awareness' });
    const instagram = learnings.find((item) => item.key === 'instagram');
    expect(instagram?.observations).toBe(5);
    expect(instagram?.evidencePostIds).not.toContain('gap');
    expect(instagram?.effectPercent).toBeGreaterThan(0);
  });

  it('creates a timing opportunity only when a measured window exists', () => {
    const posts = [
      ...Array.from({ length: 5 }, (_, index) => datedPost(`am${index}`, 40, '2026-08-25T15:00:00Z')),
      ...Array.from({ length: 15 }, (_, index) => datedPost(`pm${index}`, 10, '2026-08-25T18:00:00Z')),
    ];
    const timing = recommendPostingWindows({ posts, timeZone: 'UTC', objective: 'awareness' });
    const opportunities = generateOpportunities({
      productId: 'brand',
      timing,
      channels: [
        { platform: 'instagram', posts: 10, views: 100, engagements: 8 },
        { platform: 'tiktok', posts: 10, views: 20, engagements: 2 },
      ],
      learnings: [],
      alignmentScore: null,
      alignmentCoverage: 0,
    });
    expect(opportunities.some((item) => item.kind === 'timing')).toBe(true);
    expect(opportunities.some((item) => item.kind === 'platform')).toBe(true);
  });
});

describe('strategist evidence', () => {
  it('never turns missing metrics into zero in platform comparisons', () => {
    const rows = strategistPostRows([
      { id: 'a', platform: 'tiktok', latestMetrics: { views: 10, likes: 2 } },
      { id: 'b', platform: 'tiktok', latestMetrics: { views: null, likes: null } },
      { id: 'c', platform: 'instagram', latestMetrics: {} },
    ]);
    expect(rows[1]?.views).toBeNull();
    expect(rows[1]?.engagements).toBeNull();
    const comparisons = platformComparisons(rows);
    expect(comparisons.find((row) => row.id === 'instagram')?.views).toBeNull();
    expect(comparisons.find((row) => row.id === 'tiktok')?.views).toBe(10);
    expect(topPostsByViews(rows)[0]?.id).toBe('a');
  });
});

describe('statistics helpers', () => {
  it('keeps a percent difference undefined without a measured control mean', () => {
    expect(meanDifferencePercent([10], [0, 0])).toBeNull();
    expect(meanDifferencePercent([20, 20], [10, 10])).toBe(100);
  });

  it('returns a bootstrap interval that excludes zero for a large effect', () => {
    const interval = bootstrapMeanDifferencePercent(
      [14, 15, 16, 14, 15, 16],
      [10, 10, 11, 9, 10, 10],
      400,
    );
    expect(interval?.[0]).toBeGreaterThan(0);
  });
});

describe('tracked conversion helpers', () => {
  it('appends an opaque click id and verifies signatures', () => {
    expect(appendClickId('https://example.com/path', 'click_1')).toContain('mkcid=click_1');
    process.env.CONVERSION_INGEST_SECRET = 'test-secret';
    const body = '{"consent":true}';
    const signature = conversionSignature(body);
    expect(verifyConversionSignature(body, `sha256=${signature}`)).toBe(true);
    expect(verifyConversionSignature(body, 'sha256=deadbeef')).toBe(false);
  });
});

describe('product insights assembly', () => {
  it('keeps alignment unavailable when no actual mix is measured', () => {
    const insights = buildProductInsights({
      productId: 'brand',
      profile: defaultAudienceProfile({
        targetMarkets: [{ code: 'US', label: 'United States', weight: 100, priority: 'primary' }],
      }),
      posts: Array.from({ length: 3 }, (_, index) => datedPost(`p${index}`, 10, '2026-08-01T12:00:00Z')),
      snapshots: [],
    });
    expect(insights.alignment.score).toBeNull();
    expect(insights.timing.windows).toEqual([]);
    expect(insights.drift).toBeNull();
  });
});
