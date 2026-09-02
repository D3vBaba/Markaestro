/**
 * Activity-date attribution.
 *
 * The daily rollups (`analyticsDaily`) group a post's latest metrics under
 * the day it was published, which answers "what did the posts from Tuesday
 * earn" but not "what happened on Tuesday". Platforms' own insights are
 * activity-based, so this second series records, at every poll, how much
 * each metric grew since the last observation and books that growth under
 * the day it was observed. Increments are written with Firestore's atomic
 * counters, so concurrent polls never clobber each other and no recompute is
 * ever needed.
 *
 * Reach is the one metric where "growth" is approximate: a platform's reach
 * is unique accounts to date, so the delta is "new accounts reached since the
 * last snapshot", which is what an activity chart wants anyway.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import type { NormalizedPostMetrics } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import { engagementTotal } from './types';

export const ACTIVITY_METRICS = ['views', 'reach', 'likes', 'comments', 'shares', 'saves', 'clicks', 'engagements'] as const;
export type ActivityMetric = (typeof ACTIVITY_METRICS)[number];
export type ActivityDelta = Record<ActivityMetric, number>;

/** workspaces/{ws}/analyticsActivity/{YYYY-MM-DD} */
export type ActivityDayDoc = {
  date: string;
  updatedAt: string;
  channels: Partial<Record<SocialChannel, Partial<ActivityDelta>>>;
  byProduct?: Record<string, { channels: Partial<Record<SocialChannel, Partial<ActivityDelta>>> }>;
};

function metricValue(metrics: NormalizedPostMetrics | undefined, key: ActivityMetric): number | null {
  if (!metrics) return null;
  if (key === 'engagements') return engagementTotal(metrics);
  const value = metrics[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Growth of each metric between two observations of the same post channel.
 * A metric first observed now counts in full (the platform has usually just
 * started reporting it). A metric that went down (deleted comments, a
 * platform recount) contributes nothing rather than negative activity.
 * Metrics the platform never reports stay absent so the reader can tell
 * "no reach reported" from "no new reach".
 */
export function metricsDelta(
  previous: NormalizedPostMetrics | undefined,
  next: NormalizedPostMetrics | undefined,
): Partial<ActivityDelta> {
  const delta: Partial<ActivityDelta> = {};
  for (const key of ACTIVITY_METRICS) {
    const after = metricValue(next, key);
    if (after === null) continue;
    const before = metricValue(previous, key) ?? 0;
    delta[key] = Math.max(0, after - before);
  }
  return delta;
}

export function activityDeltasByChannel(
  previous: Partial<Record<SocialChannel, NormalizedPostMetrics>> | undefined,
  next: Partial<Record<SocialChannel, NormalizedPostMetrics>>,
): Partial<Record<SocialChannel, Partial<ActivityDelta>>> {
  const out: Partial<Record<SocialChannel, Partial<ActivityDelta>>> = {};
  for (const [channel, metrics] of Object.entries(next) as Array<[SocialChannel, NormalizedPostMetrics]>) {
    const delta = metricsDelta(previous?.[channel], metrics);
    if (Object.keys(delta).length > 0) out[channel] = delta;
  }
  return out;
}

/** Flatten deltas into the dotted increment paths one merge write applies. */
export function activityIncrements(
  deltas: Partial<Record<SocialChannel, Partial<ActivityDelta>>>,
  productId: string | null,
): Record<string, number> {
  const increments: Record<string, number> = {};
  for (const [channel, delta] of Object.entries(deltas)) {
    for (const [metric, value] of Object.entries(delta ?? {})) {
      if (!value) continue;
      increments[`channels.${channel}.${metric}`] = value;
      if (productId) increments[`byProduct.${productId}.channels.${channel}.${metric}`] = value;
    }
  }
  return increments;
}

/**
 * Book the growth between `previous` and `next` under `date` (UTC day of the
 * observation). A no-op when nothing grew, so a poll that returns the same
 * numbers writes nothing.
 */
export async function recordActivity(input: {
  workspaceId: string;
  date: string;
  productId: string | null;
  previous: Partial<Record<SocialChannel, NormalizedPostMetrics>> | undefined;
  next: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
  nowIso: string;
}): Promise<number> {
  const increments = activityIncrements(activityDeltasByChannel(input.previous, input.next), input.productId);
  const keys = Object.keys(increments);
  if (keys.length === 0) return 0;
  const update: Record<string, unknown> = { date: input.date, updatedAt: input.nowIso };
  for (const key of keys) update[key] = FieldValue.increment(increments[key]!);
  await adminDb.doc(`workspaces/${input.workspaceId}/analyticsActivity/${input.date}`).set(update, { merge: true });
  return keys.length;
}
