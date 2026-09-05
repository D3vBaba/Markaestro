/** The subset of a measured post row these calculations need. */
export type PulsePost = {
  id: string;
  platform: string;
  publishedAt: string | null;
  views: number | null;
  engagements: number | null;
  objectiveValue?: number | null;
  content?: string | null;
  mediaUrls?: string[];
  fingerprint?: { kind?: string | null; pillar?: string | null; hook?: string | null } | null;
};

const DAY = 24 * 60 * 60 * 1000;

function at(post: PulsePost): number {
  return post.publishedAt ? Date.parse(post.publishedAt) : Number.NaN;
}

function sum(values: Array<number | null | undefined>): number | null {
  const real = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return real.length > 0 ? real.reduce((a, b) => a + b, 0) : null;
}

function avg(values: Array<number | null | undefined>): number | null {
  const real = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return real.length > 0 ? real.reduce((a, b) => a + b, 0) / real.length : null;
}

function pct(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || prior === 0) return null;
  return Math.round(((current - prior) / prior) * 100);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* ───────────── weekly pulse ───────────── */

export type PulseWindow = { posts: number; views: number | null; engagements: number | null; objective: number | null };
export type WeeklyPulse = {
  thisWeek: PulseWindow;
  lastWeek: PulseWindow;
  delta: { posts: number | null; views: number | null; engagements: number | null; objective: number | null };
};

function windowTotals(posts: PulsePost[]): PulseWindow {
  return {
    posts: posts.length,
    views: sum(posts.map((p) => p.views)),
    engagements: sum(posts.map((p) => p.engagements)),
    objective: sum(posts.map((p) => p.objectiveValue ?? p.views)),
  };
}

/** This week against last week, by publish date, so Monday's brief has a direction. */
export function weeklyPulse(posts: PulsePost[], now = new Date()): WeeklyPulse {
  const end = now.getTime();
  const weekAgo = end - 7 * DAY;
  const twoWeeksAgo = end - 14 * DAY;
  const thisWeek = posts.filter((p) => at(p) >= weekAgo && at(p) <= end);
  const lastWeek = posts.filter((p) => at(p) >= twoWeeksAgo && at(p) < weekAgo);
  const a = windowTotals(thisWeek);
  const b = windowTotals(lastWeek);
  return {
    thisWeek: a,
    lastWeek: b,
    delta: {
      posts: pct(a.posts, b.posts),
      views: pct(a.views, b.views),
      engagements: pct(a.engagements, b.engagements),
      objective: pct(a.objective, b.objective),
    },
  };
}

/* ───────────── content cohorts ───────────── */

export type CohortRow = {
  dimension: 'format' | 'length' | 'cta' | 'hashtags';
  key: string;
  posts: number;
  avgViews: number | null;
  avgEngagements: number | null;
  engagementRate: number | null;
};

const CTA = /\b(link in bio|shop now|learn more|sign up|comment below|tell me|tell us|dm me|dm us|share this|save this|tap the|click the|swipe up|order now|book now|join us|try it)\b/i;

function format(post: PulsePost): string {
  const kind = post.fingerprint?.kind?.toLowerCase();
  if (kind === 'video' || kind === 'reel' || kind === 'short') return 'video';
  if (kind === 'carousel') return 'carousel';
  if (kind === 'image' || kind === 'photo') return 'image';
  const media = post.mediaUrls ?? [];
  if (media.some((url) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url))) return 'video';
  if (media.length > 1) return 'carousel';
  if (media.length === 1) return 'image';
  return 'text';
}

function lengthBucket(post: PulsePost): string {
  const n = (post.content ?? '').trim().length;
  if (n === 0) return 'none';
  if (n < 80) return 'short';
  if (n <= 220) return 'medium';
  return 'long';
}

function ctaBucket(post: PulsePost): string {
  const text = post.content ?? '';
  if (CTA.test(text)) return 'cta';
  if (/\?/.test(text)) return 'question';
  return 'none';
}

function hashtagBucket(post: PulsePost): string {
  const count = ((post.content ?? '').match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  if (count === 0) return '0';
  if (count <= 3) return '1-3';
  return '4+';
}

function rollCohort(dimension: CohortRow['dimension'], key: string, posts: PulsePost[]): CohortRow {
  const paired = posts.filter((p) => typeof p.views === 'number' && p.views > 0 && typeof p.engagements === 'number');
  const rate = paired.length > 0
    ? paired.reduce((a, p) => a + (p.engagements as number), 0) / paired.reduce((a, p) => a + (p.views as number), 0)
    : null;
  return {
    dimension,
    key,
    posts: posts.length,
    avgViews: avg(posts.map((p) => p.views)),
    avgEngagements: avg(posts.map((p) => p.engagements)),
    engagementRate: rate,
  };
}

/**
 * Which shapes of post earn more for this brand: format, caption length,
 * whether it asks for something, and hashtag load. Only measured posts count.
 */
export function contentCohorts(posts: PulsePost[]): { rows: CohortRow[] } {
  const measured = posts.filter((p) => typeof p.engagements === 'number' || typeof p.views === 'number');
  const groups: Array<[CohortRow['dimension'], (p: PulsePost) => string]> = [
    ['format', format], ['length', lengthBucket], ['cta', ctaBucket], ['hashtags', hashtagBucket],
  ];
  const rows: CohortRow[] = [];
  for (const [dimension, pick] of groups) {
    const byKey = new Map<string, PulsePost[]>();
    for (const post of measured) {
      const key = pick(post);
      byKey.set(key, [...(byKey.get(key) ?? []), post]);
    }
    for (const [key, group] of byKey) rows.push(rollCohort(dimension, key, group));
  }
  return {
    rows: rows.sort((a, b) => (b.avgEngagements ?? -1) - (a.avgEngagements ?? -1)),
  };
}

/* ───────────── pillar coverage ───────────── */

export type PillarCoverage = {
  pillar: string;
  last30: number;
  prior30: number;
  avgEngagements: number | null;
  quiet: boolean;
};

export function pillarCoverage(posts: PulsePost[], declaredPillars: string[] = [], now = new Date()): PillarCoverage[] {
  const end = now.getTime();
  const names = new Map<string, PulsePost[]>();
  for (const pillar of declaredPillars) names.set(pillar, []);
  for (const post of posts) {
    const pillar = post.fingerprint?.pillar?.trim();
    if (!pillar) continue;
    names.set(pillar, [...(names.get(pillar) ?? []), post]);
  }
  return [...names.entries()].map(([pillar, group]) => {
    const last30 = group.filter((p) => at(p) >= end - 30 * DAY && at(p) <= end).length;
    const prior30 = group.filter((p) => at(p) >= end - 60 * DAY && at(p) < end - 30 * DAY).length;
    return {
      pillar,
      last30,
      prior30,
      avgEngagements: avg(group.map((p) => p.engagements)),
      quiet: (prior30 > 0 && last30 === 0) || (prior30 >= 3 && last30 <= prior30 * 0.4),
    };
  }).sort((a, b) => b.last30 - a.last30);
}

/* ───────────── suggested experiments ───────────── */

export type SuggestedExperiment = {
  id: string;
  kind: 'timing' | 'platform' | 'hook' | 'pillar';
  title: string;
  hypothesis: string;
  platform: string | null;
  metric: 'views' | 'engagements' | 'clicks';
  armA: string;
  armB: string;
};

type TimingWindow = { weekday: string; hour: string | number; liftPercent: number | null; observations: number };
type LearningLike = { id: string; dimension: string; key: string; effectPercent: number | null; status?: string; metric?: string };

export function suggestExperiments(input: {
  windows: TimingWindow[];
  learnings: LearningLike[];
  channels: Array<{ platform: string; posts: number }>;
  metric: string;
}): SuggestedExperiment[] {
  const metric: SuggestedExperiment['metric'] = input.metric === 'engagements' || input.metric === 'clicks' ? input.metric : 'views';
  const out: SuggestedExperiment[] = [];
  const [best, alt] = input.windows;
  if (best && (best.liftPercent ?? 0) > 0) {
    const other = alt ? `${alt.weekday} ${alt.hour}:00` : 'your usual slot';
    out.push({
      id: `timing:${best.weekday}:${best.hour}`,
      kind: 'timing',
      title: `Post at ${best.weekday} ${best.hour}:00 instead of ${other}`,
      hypothesis: `The same post published ${best.weekday} at ${best.hour}:00 earns more ${metric} than at ${other}.`,
      platform: null,
      metric,
      armA: `${best.weekday} ${best.hour}:00`,
      armB: other,
    });
  }
  const live = input.learnings.filter((l) => (l.status ?? 'proposed') !== 'dismissed' && (l.effectPercent ?? 0) > 0);
  const platformLearning = live.find((l) => l.dimension === 'platform');
  if (platformLearning) {
    const other = input.channels.map((c) => c.platform).find((p) => p !== platformLearning.key) ?? null;
    if (other) {
      out.push({
        id: `platform:${platformLearning.key}`,
        kind: 'platform',
        title: `Same post on ${platformLearning.key} versus ${other}`,
        hypothesis: `A post published on ${platformLearning.key} earns more ${metric} than the same post on ${other}.`,
        platform: platformLearning.key,
        metric,
        armA: platformLearning.key,
        armB: other,
      });
    }
  }
  const hook = live.find((l) => l.dimension === 'hook' && l.key === 'has_hook');
  if (hook) {
    out.push({
      id: 'hook:has_hook',
      kind: 'hook',
      title: 'A caption with a hook versus your usual opener',
      hypothesis: `Captions that open with a hook earn more ${metric} than captions that start plainly.`,
      platform: null,
      metric,
      armA: 'With a hook',
      armB: 'Without a hook',
    });
  }
  const pillar = live.find((l) => l.dimension === 'pillar');
  if (pillar && out.length < 3) {
    out.push({
      id: `pillar:${pillar.key}`,
      kind: 'pillar',
      title: `A ${pillar.key} post versus your next planned post`,
      hypothesis: `A post on ${pillar.key} earns more ${metric} than a post on another pillar in the same week.`,
      platform: null,
      metric,
      armA: pillar.key,
      armB: 'Another pillar',
    });
  }
  return out.slice(0, 3);
}

/* ───────────── anomalies ───────────── */

export type Anomaly =
  | { kind: 'viral'; postId: string; platform: string; views: number; median: number; multiple: number }
  | { kind: 'quiet_channel'; platform: string; daysSilent: number };

export function detectAnomalies(posts: PulsePost[], now = new Date()): Anomaly[] {
  const end = now.getTime();
  const recent90 = posts.filter((p) => at(p) >= end - 90 * DAY && typeof p.views === 'number');
  const med = median(recent90.map((p) => p.views as number));
  const out: Anomaly[] = [];
  if (med !== null && med > 0 && recent90.length >= 5) {
    for (const post of recent90) {
      if (at(post) >= end - 3 * DAY && (post.views as number) >= med * 3) {
        out.push({ kind: 'viral', postId: post.id, platform: post.platform, views: post.views as number, median: med, multiple: Math.round(((post.views as number) / med) * 10) / 10 });
      }
    }
  }
  const byPlatform = new Map<string, number[]>();
  for (const post of posts) {
    const ms = at(post);
    if (!Number.isFinite(ms)) continue;
    byPlatform.set(post.platform, [...(byPlatform.get(post.platform) ?? []), ms]);
  }
  for (const [platform, times] of byPlatform) {
    const last = Math.max(...times);
    const activeBefore = times.some((ms) => ms >= end - 70 * DAY && ms < end - 10 * DAY);
    if (activeBefore && last < end - 10 * DAY) {
      out.push({ kind: 'quiet_channel', platform, daysSilent: Math.floor((end - last) / DAY) });
    }
  }
  return out;
}
