import { intelligenceRecordId } from './record-id';
import {
  bootstrapMeanDifferencePercent,
  learningStrength,
  meanDifferencePercent,
} from './statistics';
import { hourBucket, measuredObjectiveValues, type HistoricalPost } from './historical-fit';
import { mapObjective } from './historical-fit';

export type LearningPost = HistoricalPost & {
  id: string;
  platform?: string;
  fingerprint?: { pillar?: string | null; hook?: string | null; kind?: string | null } | null;
};

export type BrandLearning = {
  id: string;
  productId: string;
  dimension: 'platform' | 'pillar' | 'hook' | 'format' | 'timing';
  key: string;
  title: string;
  summary: string;
  strength: ReturnType<typeof learningStrength>;
  observations: number;
  effectPercent: number | null;
  confidenceInterval: [number, number] | null;
  evidencePostIds: string[];
  status: 'proposed' | 'accepted' | 'dismissed' | 'pinned';
};

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function groupKey(post: LearningPost, dimension: BrandLearning['dimension'], timeZone: string): string | null {
  if (dimension === 'platform') return post.platform || null;
  if (dimension === 'pillar') return post.fingerprint?.pillar || null;
  if (dimension === 'hook') return post.fingerprint?.hook ? 'has_hook' : post.fingerprint ? 'no_hook' : null;
  if (dimension === 'format') return post.fingerprint?.kind || null;
  if (dimension === 'timing') return post.publishedAt ? hourBucket(post.publishedAt, timeZone) : null;
  return null;
}

function learningForGroup(input: {
  productId: string;
  dimension: BrandLearning['dimension'];
  key: string;
  group: LearningPost[];
  rest: LearningPost[];
  objective?: string;
}): BrandLearning | null {
  const treatment = measuredObjectiveValues(input.group, input.objective);
  const control = measuredObjectiveValues(input.rest, input.objective);
  const observations = treatment.length;
  if (observations < 5 || control.length < 5) return null;
  const effectPercent = meanDifferencePercent(treatment, control);
  const interval = bootstrapMeanDifferencePercent(treatment, control, 800, 20260825);
  const varianceSupportsClaim = Boolean(
    interval && (interval[0] > 0 || interval[1] < 0) && Math.abs(effectPercent ?? 0) >= 15,
  );
  const strength = learningStrength(observations, varianceSupportsClaim);
  if (strength === 'insufficient') return null;
  const metric = mapObjective(input.objective);
  const direction = (effectPercent ?? 0) >= 0 ? 'above' : 'below';
  return {
    id: intelligenceRecordId('learning', input.productId, input.dimension, input.key),
    productId: input.productId,
    dimension: input.dimension,
    key: input.key,
    title: `${input.dimension}: ${input.key}`,
    summary: `${observations} measured posts in ${input.key} are ${direction} the rest of this brand on ${metric}`
      + (effectPercent === null ? '.' : ` (${Math.round(effectPercent)}%).`),
    strength,
    observations,
    effectPercent,
    confidenceInterval: interval,
    evidencePostIds: input.group
      .filter((post) => measuredObjectiveValues([post], input.objective).length > 0)
      .map((post) => post.id)
      .slice(0, 30),
    status: 'proposed',
  };
}

export function generateBrandLearnings(input: {
  productId: string;
  posts: LearningPost[];
  timeZone: string;
  objective?: string;
  limit?: number;
}): BrandLearning[] {
  const learnings: BrandLearning[] = [];
  const dimensions: BrandLearning['dimension'][] = ['platform', 'pillar', 'hook', 'format', 'timing'];
  for (const dimension of dimensions) {
    const grouped = new Map<string, LearningPost[]>();
    for (const post of input.posts) {
      const key = groupKey(post, dimension, input.timeZone);
      if (!key) continue;
      const list = grouped.get(key) || [];
      list.push(post);
      grouped.set(key, list);
    }
    for (const [key, group] of grouped) {
      const rest = input.posts.filter((post) => !group.includes(post));
      const learning = learningForGroup({
        productId: input.productId,
        dimension,
        key,
        group,
        rest,
        objective: input.objective,
      });
      if (learning) learnings.push(learning);
    }
  }
  return learnings
    .sort((a, b) => Math.abs(b.effectPercent ?? 0) - Math.abs(a.effectPercent ?? 0))
    .slice(0, input.limit ?? 25);
}

export function applyLearningDecisions(
  learnings: BrandLearning[],
  stored: Array<{ id: string; status?: string; title?: string; summary?: string }>,
): BrandLearning[] {
  const byId = new Map(stored.map((row) => [row.id, row]));
  return learnings.map((learning) => {
    const existing = byId.get(learning.id);
    if (!existing) return learning;
    const status = existing.status;
    if (status === 'accepted' || status === 'dismissed' || status === 'pinned') {
      return { ...learning, status };
    }
    return learning;
  });
}
