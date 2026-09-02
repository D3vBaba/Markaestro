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

/* ── Backfill from stored snapshots ──────────────────────────────────
 * The poller has always written a snapshot per stage under each post, so the
 * activity series can be rebuilt for history: consecutive snapshots of a post
 * give the same growth the live path books, filed under the day each was
 * captured. Snapshots the live path already booked carry `activityBooked`,
 * and a post that has been rebuilt carries `activityBackfilledAt`, so the
 * rebuild is exactly-once per post and never double counts.
 */

export type ActivitySnapshotInput = {
  capturedAt: string;
  byChannel: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
  activityBooked?: boolean;
};

/** Growth per observation day from one post's snapshot history. Pure. */
export function activityFromSnapshots(
  snapshots: ActivitySnapshotInput[],
  productId: string | null,
): Map<string, Record<string, number>> {
  const byDate = new Map<string, Record<string, number>>();
  const ordered = snapshots
    .filter((snap) => typeof snap.capturedAt === 'string' && Number.isFinite(Date.parse(snap.capturedAt)))
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  let previous: Partial<Record<SocialChannel, NormalizedPostMetrics>> | undefined;
  for (const snap of ordered) {
    const next = snap.byChannel ?? {};
    if (!snap.activityBooked) {
      const increments = activityIncrements(activityDeltasByChannel(previous, next), productId);
      if (Object.keys(increments).length > 0) {
        const date = snap.capturedAt.slice(0, 10);
        const bucket = byDate.get(date) ?? {};
        for (const [key, value] of Object.entries(increments)) bucket[key] = (bucket[key] ?? 0) + value;
        byDate.set(date, bucket);
      }
    }
    previous = next;
  }
  return byDate;
}

export const ACTIVITY_BACKFILL_PAGE = 100;
/** Firestore batches hold 500 writes; leave room for the meta cursor and markers. */
const BATCH_WRITE_CEILING = 450;

export type ActivityBackfillPage = {
  /** Posts examined in this page. */
  posts: number;
  /** Posts that had unbooked snapshots. */
  booked: number;
  /** Distinct observation days written. */
  days: number;
  done: boolean;
  /** `publishedAt` of the last post examined; pass back as `afterPublishedAt`. */
  cursor: string | null;
};

/**
 * Rebuild activity for one page of published posts, newest first, and mark
 * each as done in the same atomic batch as its increments. Called by the
 * worker tick until `done`; a crash between pages re-reads the same page and
 * skips the posts already marked.
 */
export async function backfillActivityPage(
  workspaceId: string,
  nowIso: string,
  opts: { afterPublishedAt?: string | null; limit?: number } = {},
): Promise<ActivityBackfillPage> {
  const limit = Math.min(Math.max(opts.limit ?? ACTIVITY_BACKFILL_PAGE, 1), ACTIVITY_BACKFILL_PAGE);
  let query: FirebaseFirestore.Query = adminDb
    .collection(`workspaces/${workspaceId}/posts`)
    .where('status', '==', 'published')
    .orderBy('publishedAt', 'desc');
  if (opts.afterPublishedAt) query = query.startAfter(opts.afterPublishedAt);
  const snap = await query.limit(limit).get();
  const page: ActivityBackfillPage = { posts: snap.size, booked: 0, days: 0, done: snap.size < limit, cursor: null };
  if (snap.empty) return page;

  const totals = new Map<string, Record<string, number>>();
  const markers: FirebaseFirestore.DocumentReference[] = [];
  let writes = 0;

  for (const doc of snap.docs) {
    const post = doc.data() as {
      testMode?: boolean;
      productId?: string;
      publishedAt?: string;
      activityBackfilledAt?: string;
    };
    page.cursor = post.publishedAt ?? page.cursor;
    if (post.activityBackfilledAt || post.testMode === true) continue;
    const history = await doc.ref.collection('metrics').orderBy('capturedAt', 'asc').limit(50).get();
    const perDate = activityFromSnapshots(
      history.docs.map((entry) => entry.data() as ActivitySnapshotInput),
      typeof post.productId === 'string' && post.productId ? post.productId : null,
    );
    let projected = writes + 1;
    for (const date of perDate.keys()) if (!totals.has(date)) projected++;
    // A page whose increments would overflow one atomic batch stops early;
    // the cursor only advances past posts that are in the batch.
    if (projected > BATCH_WRITE_CEILING && markers.length > 0) {
      page.done = false;
      break;
    }
    for (const [date, increments] of perDate) {
      const bucket = totals.get(date) ?? {};
      for (const [key, value] of Object.entries(increments)) bucket[key] = (bucket[key] ?? 0) + value;
      totals.set(date, bucket);
    }
    if (perDate.size > 0) page.booked++;
    markers.push(doc.ref);
    writes = projected;
  }

  if (markers.length === 0) return page;
  const batch = adminDb.batch();
  for (const [date, increments] of totals) {
    const update: Record<string, unknown> = { date, updatedAt: nowIso };
    for (const [key, value] of Object.entries(increments)) update[key] = FieldValue.increment(value);
    batch.set(adminDb.doc(`workspaces/${workspaceId}/analyticsActivity/${date}`), update, { merge: true });
  }
  for (const ref of markers) batch.update(ref, { activityBackfilledAt: nowIso });
  await batch.commit();
  page.days = totals.size;
  // The cursor must not skip posts that were cut from this batch: it points
  // at the last post actually committed.
  const lastCommitted = snap.docs.find((doc) => doc.ref.path === markers[markers.length - 1]!.path);
  page.cursor = (lastCommitted?.data() as { publishedAt?: string } | undefined)?.publishedAt ?? page.cursor;
  return page;
}
