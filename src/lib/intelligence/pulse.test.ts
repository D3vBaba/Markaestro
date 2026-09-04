import { describe, expect, it } from 'vitest';
import { contentCohorts, decisionOutcome, detectAnomalies, pillarCoverage, shouldStopEarly, suggestExperiments, weeklyPulse, type PulsePost } from './pulse';

const now = new Date('2026-09-04T12:00:00Z');
const days = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const post = (id: string, extra: Partial<PulsePost>): PulsePost => ({ id, platform: 'instagram', publishedAt: days(1), views: 100, engagements: 10, ...extra });

describe('weeklyPulse', () => {
  it('splits posts by week and reports deltas', () => {
    const pulse = weeklyPulse([post('a', { views: 300 }), post('b', { publishedAt: days(9), views: 100 }), post('c', { publishedAt: days(10), views: 100 })], now);
    expect(pulse.thisWeek).toMatchObject({ posts: 1, views: 300 });
    expect(pulse.lastWeek).toMatchObject({ posts: 2, views: 200 });
    expect(pulse.delta.views).toBe(50);
    expect(pulse.delta.posts).toBe(-50);
  });
});

describe('contentCohorts', () => {
  it('groups by format, length, call to action and hashtags and flags weak cohorts', () => {
    const rows = [
      post('v1', { mediaUrls: ['a.mp4'], content: 'Watch this? #a #b', engagements: 40 }),
      post('v2', { mediaUrls: ['b.mp4'], content: 'Short', engagements: 30 }),
      post('i1', { mediaUrls: ['a.jpg'], content: 'x'.repeat(300), engagements: 2 }),
      post('i2', { mediaUrls: ['b.jpg'], content: 'y'.repeat(300), engagements: 1 }),
      post('i3', { mediaUrls: ['c.jpg'], content: 'z'.repeat(300), engagements: 1 }),
    ];
    const { rows: cohorts, stopDoing } = contentCohorts(rows);
    const video = cohorts.find((r) => r.dimension === 'format' && r.key === 'video');
    expect(video).toMatchObject({ posts: 2, avgEngagements: 35 });
    expect(cohorts.find((r) => r.dimension === 'cta' && r.key === 'question')?.posts).toBe(1);
    expect(cohorts.find((r) => r.dimension === 'hashtags' && r.key === '1-3')?.posts).toBe(1);
    expect(stopDoing.map((r) => `${r.dimension}:${r.key}`)).toEqual(expect.arrayContaining(['format:image', 'length:long']));
  });
});

describe('pillarCoverage', () => {
  it('flags a pillar that went quiet', () => {
    const rows = pillarCoverage([
      post('a', { publishedAt: days(40), fingerprint: { pillar: 'Education' } }),
      post('b', { publishedAt: days(45), fingerprint: { pillar: 'Education' } }),
      post('c', { publishedAt: days(2), fingerprint: { pillar: 'Offers' } }),
    ], ['Community'], now);
    expect(rows.find((r) => r.pillar === 'Education')).toMatchObject({ last30: 0, prior30: 2, quiet: true });
    expect(rows.find((r) => r.pillar === 'Offers')).toMatchObject({ last30: 1, quiet: false });
    expect(rows.find((r) => r.pillar === 'Community')).toMatchObject({ last30: 0, prior30: 0, quiet: false });
  });
});

describe('decisionOutcome', () => {
  it('compares four weeks before and after a decision', () => {
    const decidedAt = days(30);
    const outcome = decisionOutcome([
      post('b1', { publishedAt: days(40), views: 100 }),
      post('b2', { publishedAt: days(35), views: 100 }),
      post('a1', { publishedAt: days(20), views: 200 }),
      post('a2', { publishedAt: days(10), views: 200 }),
    ], decidedAt, now);
    expect(outcome).toMatchObject({ before: 100, after: 200, changePct: 100, sampleBefore: 2, sampleAfter: 2, ready: true });
  });
});

describe('suggestExperiments', () => {
  it('turns the best window and strongest learnings into testable arms', () => {
    const out = suggestExperiments({
      windows: [{ weekday: 'Sunday', hour: 10, liftPercent: 12, observations: 8 }, { weekday: 'Tuesday', hour: 8, liftPercent: -5, observations: 6 }],
      learnings: [{ id: 'l1', dimension: 'platform', key: 'tiktok', effectPercent: 40 }, { id: 'l2', dimension: 'hook', key: 'Did you know', effectPercent: 20, status: 'dismissed' }],
      channels: [{ platform: 'tiktok', posts: 10 }, { platform: 'instagram', posts: 8 }],
      metric: 'engagements',
    });
    expect(out.map((e) => e.kind)).toEqual(['timing', 'platform']);
    expect(out[1]).toMatchObject({ armA: 'tiktok', armB: 'instagram', metric: 'engagements' });
  });
});

describe('detectAnomalies', () => {
  it('spots a post taking off and a channel gone quiet', () => {
    const base = Array.from({ length: 6 }, (_, i) => post(`p${i}`, { publishedAt: days(20 + i), views: 100 }));
    const out = detectAnomalies([
      ...base,
      post('hot', { publishedAt: days(1), views: 900 }),
      post('li', { platform: 'linkedin', publishedAt: days(30), views: 50 }),
    ], now);
    expect(out).toContainEqual(expect.objectContaining({ kind: 'viral', postId: 'hot', multiple: 9 }));
    expect(out).toContainEqual(expect.objectContaining({ kind: 'quiet_channel', platform: 'linkedin', daysSilent: 30 }));
    expect(out.some((a) => a.kind === 'quiet_channel' && a.platform === 'instagram')).toBe(false);
  });
});

describe('shouldStopEarly', () => {
  it('waits for half the sample and a decisive gap', () => {
    expect(shouldStopEarly({ armA: [10], armB: [1], targetSamplePerArm: 4 }).stop).toBe(false);
    const decisive = shouldStopEarly({ armA: [100, 110, 105, 98], armB: [10, 12, 9, 11], targetSamplePerArm: 6 });
    expect(decisive.stop).toBe(true);
    expect(decisive.status).toBe('winner_a');
    expect(shouldStopEarly({ armA: [10, 11, 9], armB: [10, 12, 8], targetSamplePerArm: 6 }).stop).toBe(false);
  });
});
