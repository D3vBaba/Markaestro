/**
 * Metrics for platform-native posts.
 *
 * The native importer discovers posts published directly on a connected
 * account and stores them as canonical social posts (provenance
 * `platform_native`) with the poll state `initialNativePollState` sets: due
 * at once. This poller fetches their metrics through the same channel
 * adapters and connection lookup the Markaestro poller uses, writes the
 * same shape of stage snapshot and denormalized `metricsByChannel`, books the
 * growth into the activity series, and walks the same decaying schedule from
 * wherever the post's age falls. The Analytics page, the CSV export, and the
 * public API then read both kinds of post alike.
 *
 * What differs from `pollDueMetrics`: a native post has exactly one channel,
 * its first snapshot is `discovered` (taken whatever the post's age, so a
 * two-month-old post has numbers today rather than at day 90), and the
 * canonical dual-write is skipped because the polled document already is the
 * canonical one.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import type { PlatformConnection } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import { logger } from '@/lib/logger';
import {
  bookActivity,
  fetchPostChannelMetrics,
  nextPollAfter,
  type MetricsPollSummary,
} from './metrics-poller';
import {
  NATIVE_DISCOVERED_STAGE,
  NATIVE_POST_PROVENANCE,
  nativeStageKey,
  recordNativeObservation,
  type NativeSocialPostDoc,
} from './native-posts';
import { MAX_METRIC_POLLS_PER_TICK, MAX_TRANSIENT_ATTEMPTS, utcDateOf } from './types';

/**
 * Fetch metrics for every due native post in the workspace (bounded per
 * tick), mirroring `pollDueMetrics` for the `posts` collection. Only native
 * documents ever carry `metricsNextPollAt`, so the due query needs no
 * provenance filter; a document that turned into a Markaestro post since it
 * was scheduled (the Markaestro poller's dual-write) is unscheduled here and
 * left to that poller.
 */
export async function pollDueNativePosts(workspaceId: string, nowIso: string): Promise<MetricsPollSummary> {
  const summary: MetricsPollSummary = { due: 0, polled: 0, channelFetches: 0, affectedDates: [], errors: [] };
  const now = Date.parse(nowIso);

  const dueSnap = await adminDb
    .collection(`workspaces/${workspaceId}/socialPosts`)
    .where('metricsNextPollAt', '<=', nowIso)
    .orderBy('metricsNextPollAt', 'asc')
    .limit(MAX_METRIC_POLLS_PER_TICK)
    .get();
  summary.due = dueSnap.size;
  if (dueSnap.empty) return summary;

  const connectionCache = new Map<string, PlatformConnection | null>();
  const authFlagged = new Set<string>();
  const refreshAttempted = new Set<string>();

  for (const doc of dueSnap.docs) {
    try {
      await pollOneNativePost(doc, workspaceId, nowIso, now, connectionCache, authFlagged, refreshAttempted, summary);
    } catch (err) {
      // One flaky post/write must not stall the rest of the batch; the post
      // stays due and is retried next tick.
      summary.errors.push({ postId: doc.id, error: err instanceof Error ? err.message : 'unknown' });
    }
  }

  return summary;
}

async function pollOneNativePost(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  workspaceId: string,
  nowIso: string,
  now: number,
  connectionCache: Map<string, PlatformConnection | null>,
  authFlagged: Set<string>,
  refreshAttempted: Set<string>,
  summary: MetricsPollSummary,
): Promise<void> {
  const post = doc.data() as NativeSocialPostDoc;
  const ref = doc.ref;

  if (post.provenance !== NATIVE_POST_PROVENANCE) {
    // The Markaestro poller took this post over; its schedule lives on the
    // `posts` document now.
    await ref.update({ metricsNextPollAt: FieldValue.delete(), metricsUpdatedAt: nowIso });
    return;
  }
  const channel = post.platform as SocialChannel | undefined;
  if (!channel || !post.externalId) {
    await ref.update({
      metricsStatus: 'unsupported',
      metricsLastError: 'No platform post ID recorded at discovery',
      metricsNextPollAt: FieldValue.delete(),
      metricsUpdatedAt: nowIso,
    });
    return;
  }

  const publishedAt = post.publishedAt || post.discoveredAt || nowIso;
  const stage = post.metricsPollStage ?? NATIVE_DISCOVERED_STAGE;
  const stageKey = nativeStageKey(stage);
  const productId = typeof post.productId === 'string' && post.productId ? post.productId : undefined;

  const { byChannel, outcomes, lastError, channelFetches } = await fetchPostChannelMetrics(
    {
      productId,
      content: post.content ?? undefined,
      channel,
      // The account the post was discovered on is the one to ask; a brand
      // can have several accounts linked for one channel.
      destinationId: post.accountKey,
      destinationProvider: post.provider,
      metricsByChannel: post.metricsByChannel,
    },
    [{ channel, externalId: post.externalId }],
    publishedAt,
    workspaceId,
    doc.id,
    connectionCache,
    authFlagged,
    refreshAttempted,
    { canonicalUpsert: false },
  );
  summary.channelFetches += channelFetches;

  const outcome = outcomes[0] ?? 'unsupported';

  if (outcome === 'ok') {
    const metrics = byChannel[channel];
    const snapshotRef = await recordNativeObservation(ref, {
      channel,
      stageKey,
      capturedAt: nowIso,
      publishedAt: post.publishedAt ?? null,
      byChannel,
    });
    await bookActivity(workspaceId, { productId, metricsByChannel: post.metricsByChannel }, byChannel, nowIso, snapshotRef);
    const next = nextPollAfter(stage, publishedAt, now);
    await ref.update({
      metricsByChannel: byChannel,
      latestMetrics: metrics,
      metricsUpdatedAt: nowIso,
      metricsLastError: FieldValue.delete(),
      metricsAttempts: 0,
      metricsStatus: next ? 'active' : 'complete',
      ...(next
        ? { metricsPollStage: next.stage, metricsNextPollAt: next.nextAt }
        : { metricsNextPollAt: FieldValue.delete() }),
    });
    summary.polled++;
    const date = utcDateOf(publishedAt);
    if (!summary.affectedDates.includes(date)) summary.affectedDates.push(date);
    return;
  }

  if (outcome === 'unsupported' || outcome === 'not_found') {
    // Gone from the platform, or a channel that offers no post metrics:
    // parked, like the Markaestro poller does, so it leaves the due queue.
    await ref.update({
      metricsStatus: 'unsupported',
      metricsLastError: lastError || 'Metrics not available for this post',
      metricsNextPollAt: FieldValue.delete(),
      metricsUpdatedAt: nowIso,
    });
    return;
  }

  const attempts = (post.metricsAttempts ?? 0) + 1;
  if (attempts >= MAX_TRANSIENT_ATTEMPTS) {
    await ref.update({
      metricsStatus: 'failed',
      metricsAttempts: attempts,
      metricsLastError: lastError || 'Metrics fetch kept failing',
      metricsNextPollAt: FieldValue.delete(),
      metricsUpdatedAt: nowIso,
    });
    summary.errors.push({ postId: doc.id, error: lastError || 'metrics fetch failed permanently' });
    return;
  }
  const backoffMs = Math.min(attempts * 3600_000, 24 * 3600_000);
  await ref.update({
    metricsAttempts: attempts,
    metricsLastError: lastError || 'transient metrics error',
    metricsNextPollAt: new Date(now + backoffMs).toISOString(),
  });
  summary.errors.push({ postId: doc.id, error: lastError || 'transient metrics error' });
  logger.debug('native post metrics retry scheduled', {
    event: 'analytics.native_metrics_retry',
    workspaceId,
    socialPostId: doc.id,
    attempts,
  });
}
