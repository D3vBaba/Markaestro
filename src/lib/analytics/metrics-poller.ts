import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getAllMatchingDocs } from '@/lib/firestore-pagination';
import { getAdapterForChannel } from '@/lib/platform/registry';
import { getConnectionForChannel, setConnectionStatus } from '@/lib/platform/connections';
import { refreshableProvider, refreshConnectionToken } from '@/lib/oauth/token-refresh';
import type { NormalizedPostMetrics, PlatformConnection } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import { logger } from '@/lib/logger';
import { getPostChannelDestinations } from '@/lib/social/publisher';
import { publishedChannelTargets } from '@/lib/intelligence/publish-targets';
import { annotateMetricAvailability } from './metric-availability';
import { recordActivity } from './activity';
import { persistRawPlatformMetrics } from '@/lib/intelligence/raw-platform-metrics';
import { canonicalSocialPostId } from '@/lib/intelligence/canonical-social-posts';
import { assertMetricsSupported, PLATFORM_CAPABILITY_REGISTRY } from '@/lib/platform/capabilities';
import { upsertMarkaestroSocialPost } from '@/lib/intelligence/canonical-social-posts';
import {
  MAX_METRIC_POLLS_PER_TICK,
  MAX_TRANSIENT_ATTEMPTS,
  METRIC_POLL_STAGES,
  METRICS_BACKFILL_DAYS,
  utcDateOf,
} from './types';

export type MetricsPollSummary = {
  due: number;
  polled: number;
  channelFetches: number;
  affectedDates: string[];
  errors: Array<{ postId: string; error: string }>;
  /** Posts an on-demand refresh parked because the platform no longer serves them. */
  parked?: number;
  /** On-demand refresh only: posts in scope that the time budget did not reach. */
  remaining?: number;
  /** On-demand refresh only: parked posts (unsupported or failed) left alone. */
  skippedDead?: number;
};

type PublishResultEntry = {
  channel?: string;
  success?: boolean;
  externalId?: string;
};

type PostDocData = {
  testMode?: boolean;
  channel?: string;
  targetChannels?: string[];
  externalId?: string;
  productId?: string;
  campaignId?: string;
  content?: string;
  mediaUrls?: string[];
  destinationId?: string;
  destinationProvider?: string;
  channelDestinations?: Record<string, string>;
  publishedAt?: string;
  publishResults?: PublishResultEntry[];
  metricsByChannel?: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
  metricsPollStage?: number;
  metricsAttempts?: number;
  metricsStatus?: string;
  metricsNextPollAt?: string;
};

/**
 * Initial poll state for a post published at `publishedAtIso`: the first
 * stage that is still in the future, or a single final catch-up snapshot for
 * posts already past the last stage (backfill case).
 */
export function initialPollState(publishedAtIso: string, nowMs: number): { stage: number; nextAt: string } {
  const publishedMs = Date.parse(publishedAtIso);
  for (let i = 0; i < METRIC_POLL_STAGES.length; i++) {
    const at = publishedMs + METRIC_POLL_STAGES[i].offsetMs;
    if (at > nowMs) return { stage: i, nextAt: new Date(at).toISOString() };
  }
  return { stage: METRIC_POLL_STAGES.length - 1, nextAt: new Date(nowMs).toISOString() };
}

function nextPollAfter(stage: number, publishedAtIso: string, nowMs: number): { stage: number; nextAt: string } | null {
  const publishedMs = Date.parse(publishedAtIso);
  for (let i = stage + 1; i < METRIC_POLL_STAGES.length; i++) {
    const at = publishedMs + METRIC_POLL_STAGES[i].offsetMs;
    if (at > nowMs) return { stage: i, nextAt: new Date(at).toISOString() };
  }
  return null;
}

/**
 * Fetch metrics for every due published post in the workspace (bounded per
 * tick), write time-series snapshots, refresh the denormalized latest metrics
 * on each post, and advance the decaying poll schedule.
 */
/**
 * Book metric growth under today's activity rollup. Sandbox posts never reached
 * a platform, and a failure here must not lose the poll itself.
 */
async function bookActivity(
  workspaceId: string,
  post: PostDocData,
  byChannel: Partial<Record<SocialChannel, NormalizedPostMetrics>>,
  nowIso: string,
  snapshotRef?: FirebaseFirestore.DocumentReference,
): Promise<void> {
  if (post.testMode === true) return;
  try {
    await recordActivity({
      workspaceId,
      date: utcDateOf(nowIso),
      productId: typeof post.productId === 'string' && post.productId ? post.productId : null,
      previous: post.metricsByChannel,
      next: byChannel,
      nowIso,
    });
    // The snapshot now carries the "already booked" marker the one-time
    // rebuild from history relies on to never count an observation twice.
    if (snapshotRef) await snapshotRef.update({ activityBooked: true });
  } catch (error) {
    logger.warn('activity rollup write failed', {
      event: 'analytics.activity_write_failed',
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function pollDueMetrics(workspaceId: string, nowIso: string): Promise<MetricsPollSummary> {
  const summary: MetricsPollSummary = { due: 0, polled: 0, channelFetches: 0, affectedDates: [], errors: [] };
  const now = Date.parse(nowIso);

  const dueSnap = await adminDb
    .collection(`workspaces/${workspaceId}/posts`)
    .where('status', '==', 'published')
    .where('metricsNextPollAt', '<=', nowIso)
    .orderBy('metricsNextPollAt', 'asc')
    .limit(MAX_METRIC_POLLS_PER_TICK)
    .get();
  summary.due = dueSnap.size;
  if (dueSnap.empty) return summary;

  // Connections resolved once per (channel, productId) pair per tick.
  const connectionCache = new Map<string, PlatformConnection | null>();
  const authFlagged = new Set<string>();
  const refreshAttempted = new Set<string>();

  for (const doc of dueSnap.docs) {
    try {
      await pollOnePost(doc, workspaceId, nowIso, now, connectionCache, authFlagged, summary, refreshAttempted);
    } catch (err) {
      // One flaky post/write must not stall the rest of the batch; the post
      // stays due and is retried next tick.
      summary.errors.push({ postId: doc.id, error: err instanceof Error ? err.message : 'unknown' });
    }
  }

  return summary;
}

type ChannelFetchOutcome = 'ok' | 'auth' | 'not_found' | 'unsupported' | 'transient';

/**
 * Fetch the latest metrics for each published channel target of a post.
 * Shared by the scheduled poller (pollOnePost) and the on-demand refresh
 * (refreshPostsNow). Connections are resolved through the provided cache, and
 * an auth failure flags the connection's health once per (provider, product).
 */
async function fetchPostChannelMetrics(
  post: PostDocData,
  targets: Array<{ channel: SocialChannel; externalId: string }>,
  publishedAt: string,
  workspaceId: string,
  legacyPostId: string,
  connectionCache: Map<string, PlatformConnection | null>,
  authFlagged: Set<string>,
  refreshAttempted: Set<string> = new Set(),
): Promise<{
  byChannel: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
  outcomes: ChannelFetchOutcome[];
  lastError: string;
  channelFetches: number;
}> {
  const byChannel: Partial<Record<SocialChannel, NormalizedPostMetrics>> = { ...(post.metricsByChannel ?? {}) };
  const outcomes: ChannelFetchOutcome[] = [];
  let lastError = '';
  let channelFetches = 0;
  const channelDestinations = getPostChannelDestinations(post as unknown as Record<string, unknown>);

  for (const target of targets) {
    const adapter = getAdapterForChannel(target.channel);
    if (!adapter?.fetchMetrics) {
      outcomes.push('unsupported');
      continue;
    }

    // Metrics must come from the account the post actually went to — a brand
    // can have several Pages/accounts linked for one channel.
    const destinationId = channelDestinations[target.channel];
    const cacheKey = `${target.channel}:${post.productId || ''}:${destinationId || ''}`;
    let connection = connectionCache.get(cacheKey);
    if (connection === undefined) {
      connection = await getConnectionForChannel(
        workspaceId,
        target.channel,
        post.productId || undefined,
        post.destinationProvider || undefined,
        destinationId,
      );
      connectionCache.set(cacheKey, connection);
    }
    if (!connection) {
      outcomes.push('transient');
      lastError = `No connected ${target.channel} account`;
      continue;
    }

    channelFetches++;
    const fetchInput = {
      channel: target.channel,
      externalId: target.externalId,
      publishedAt,
      destinationId: destinationId ?? post.destinationId,
    };
    let result = await adapter.fetchMetrics(connection, fetchInput);

    // A rejected token is not yet a dead connection: platforms rotate and
    // revoke access tokens while the refresh token stays good (TikTok's
    // 24-hour tokens especially). Refresh once and retry before flagging
    // the connection, so one stale token never parks a brand's metrics
    // until the next scheduled refresh pass.
    if (!result.ok && result.reason === 'auth' && connection.refreshTokenEncrypted) {
      const provider = refreshableProvider(connection.provider);
      if (provider && !refreshAttempted.has(cacheKey)) {
        refreshAttempted.add(cacheKey);
        const refreshed = await refreshConnectionToken(workspaceId, provider, connection, post.productId || undefined)
          .catch((error: unknown) => {
            logger.warn('metrics token refresh failed', {
              event: 'analytics.metrics_token_refresh_failed',
              workspaceId,
              channel: target.channel,
              productId: post.productId ?? null,
              err: error,
            });
            return null;
          });
        if (refreshed) {
          connection = refreshed;
          connectionCache.set(cacheKey, refreshed);
          channelFetches++;
          result = await adapter.fetchMetrics(refreshed, fetchInput);
          logger.info('metrics token refreshed after auth failure', {
            event: 'analytics.metrics_token_refreshed',
            workspaceId,
            channel: target.channel,
            productId: post.productId ?? null,
            recovered: result.ok,
          });
        }
      }
    }

    if (result.ok) {
      assertMetricsSupported(target.channel, result.metrics);
      const capturedAt = new Date().toISOString();
      const canonicalId = canonicalSocialPostId(target.channel, connection.accountKey || connection.provider, target.externalId);
      try {
        await persistRawPlatformMetrics({
          workspaceId,
          socialPostId: canonicalId,
          channel: target.channel,
          provider: connection.provider,
          apiVersion: PLATFORM_CAPABILITY_REGISTRY[target.channel].apiVersion,
          externalId: target.externalId,
          capturedAt,
          payload: result.metrics,
        });
      } catch (error) {
        // Raw retention is additive and must not interrupt the legacy analytics
        // write path during rollout or a Storage incident.
        logger.warn('raw platform metrics persistence failed', {
          event: 'intelligence.raw_metrics_failed',
          workspaceId,
          channel: target.channel,
          err: error,
        });
      }
      const annotated = annotateMetricAvailability(target.channel, result.metrics, connection, capturedAt);
      byChannel[target.channel] = annotated;
      try {
        await upsertMarkaestroSocialPost({
          workspaceId,
          legacyPostId,
          productId: post.productId,
          campaignId: post.campaignId,
          channel: target.channel,
          externalId: target.externalId,
          publishedAt,
          content: post.content,
          mediaUrls: post.mediaUrls,
          connection,
          metrics: annotated,
          capturedAt,
          stageKey: 'latest',
        });
      } catch (error) {
        logger.warn('canonical social post dual-write failed', {
          event: 'intelligence.dual_write_failed',
          workspaceId,
          channel: target.channel,
          err: error,
        });
      }
      outcomes.push('ok');
    } else {
      outcomes.push(result.reason);
      lastError = result.error;
      if (result.reason === 'auth') {
        // Surface token problems on the connection (integration status
        // machine) so the channel shows a health warning — but only once
        // per connection per run.
        const flagKey = `${connection.connectionId || connection.provider}:${connection.productId || ''}`;
        if (!authFlagged.has(flagKey)) {
          authFlagged.add(flagKey);
          try {
            await setConnectionStatus(connection, 'error');
          } catch { /* connection doc may be gone; the poll retry covers it */ }
        }
      }
    }
  }

  return { byChannel, outcomes, lastError, channelFetches };
}

async function pollOnePost(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  workspaceId: string,
  nowIso: string,
  now: number,
  connectionCache: Map<string, PlatformConnection | null>,
  authFlagged: Set<string>,
  summary: MetricsPollSummary,
  refreshAttempted: Set<string> = new Set(),
): Promise<void> {
  const post = doc.data() as PostDocData;
  const postRef = doc.ref;

  // Sandbox posts carry a fake external id (mk_test_...). Polling one would
  // hand that id to a real platform API, which at best 404s per tick forever.
  // Marked unsupported once so the post drops out of the due queue.
  if (post.testMode === true) {
    await postRef.update({
      metricsStatus: 'unsupported',
      metricsLastError: 'Test-mode post: no platform metrics exist',
      metricsNextPollAt: FieldValue.delete(),
      metricsUpdatedAt: nowIso,
    });
    return;
  }

  const publishedAt = post.publishedAt || nowIso;
  const stage = Math.min(post.metricsPollStage ?? 0, METRIC_POLL_STAGES.length - 1);
  const stageKey = METRIC_POLL_STAGES[stage].key;
  const targets = publishedChannelTargets(post);

  if (targets.length === 0) {
    await postRef.update({
      metricsStatus: 'unsupported',
      metricsLastError: 'No platform post ID recorded at publish time',
      metricsNextPollAt: FieldValue.delete(),
      metricsUpdatedAt: nowIso,
    });
    return;
  }

  const { byChannel, outcomes, lastError, channelFetches } = await fetchPostChannelMetrics(
    post,
    targets,
    publishedAt,
    workspaceId,
    doc.id,
    connectionCache,
    authFlagged,
    refreshAttempted,
  );
  summary.channelFetches += channelFetches;

  const anyOk = outcomes.includes('ok');
  const allDead = outcomes.every((o) => o === 'unsupported' || o === 'not_found');
  const hasRetryableError = outcomes.some((o) => o === 'auth' || o === 'transient');

  if (anyOk) {
    const snapshotRef = postRef.collection('metrics').doc(stageKey);
    await snapshotRef.set({
      postId: doc.id,
      stageKey,
      capturedAt: nowIso,
      publishedAt: post.publishedAt ?? null,
      byChannel,
    });
    await bookActivity(workspaceId, post, byChannel, nowIso, snapshotRef);
    const next = nextPollAfter(stage, publishedAt, now);
    const attempts = hasRetryableError ? (post.metricsAttempts ?? 0) + 1 : 0;
    const retryMixed = hasRetryableError && attempts < MAX_TRANSIENT_ATTEMPTS;
    const update: Record<string, unknown> = {
      metricsByChannel: byChannel,
      metricsUpdatedAt: nowIso,
      metricsLastError: lastError || FieldValue.delete(),
    };
    if (retryMixed) {
      const backoffMs = Math.min(attempts * 3600_000, 24 * 3600_000);
      Object.assign(update, {
        metricsStatus: 'active',
        metricsAttempts: attempts,
        metricsPollStage: stage,
        metricsNextPollAt: new Date(now + backoffMs).toISOString(),
      });
      summary.errors.push({ postId: doc.id, error: lastError || 'partial metrics fetch failed; retry scheduled' });
    } else {
      Object.assign(update, {
        metricsStatus: next ? 'active' : 'complete',
        metricsAttempts: 0,
        ...(next
          ? { metricsPollStage: next.stage, metricsNextPollAt: next.nextAt }
          : { metricsNextPollAt: FieldValue.delete() }),
      });
      if (hasRetryableError) {
        summary.errors.push({ postId: doc.id, error: lastError || 'partial metrics fetch retry budget exhausted' });
      }
    }
    await postRef.update(update);
    summary.polled++;
    const date = utcDateOf(publishedAt);
    if (!summary.affectedDates.includes(date)) summary.affectedDates.push(date);
  } else if (allDead) {
    await postRef.update({
      metricsStatus: 'unsupported',
      metricsLastError: lastError || 'Metrics not available for this post',
      metricsNextPollAt: FieldValue.delete(),
      metricsUpdatedAt: nowIso,
    });
  } else {
    const attempts = (post.metricsAttempts ?? 0) + 1;
    if (attempts >= MAX_TRANSIENT_ATTEMPTS) {
      await postRef.update({
        metricsStatus: 'failed',
        metricsAttempts: attempts,
        metricsLastError: lastError || 'Metrics fetch kept failing',
        metricsNextPollAt: FieldValue.delete(),
        metricsUpdatedAt: nowIso,
      });
      summary.errors.push({ postId: doc.id, error: lastError || 'metrics fetch failed permanently' });
    } else {
      const backoffMs = Math.min(attempts * 3600_000, 24 * 3600_000);
      await postRef.update({
        metricsAttempts: attempts,
        metricsLastError: lastError || 'transient metrics error',
        metricsNextPollAt: new Date(now + backoffMs).toISOString(),
      });
      summary.errors.push({ postId: doc.id, error: lastError || 'transient metrics error' });
    }
  }
}

/**
 * On-demand, ad-hoc metrics refresh for the most recent published posts,
 * optionally filtered by product / channel. Unlike pollDueMetrics this ignores
 * the decaying poll schedule and — deliberately — does NOT advance it: it only
 * refreshes the denormalized `metricsByChannel` (and writes a snapshot at the
 * post's current stage) so the Analytics page can pull live numbers when the
 * user clicks Refresh. Bounded by `limit` and run with light concurrency to
 * stay within the request/client timeout while capping platform API load.
 */
/** Upper bound on posts one on-demand refresh may touch; the deadline usually binds first. */
export const MAX_REFRESH_POSTS = 60;

export async function refreshPostsNow(
  workspaceId: string,
  nowIso: string,
  opts: {
    productId?: string;
    channel?: SocialChannel;
    sinceIso?: string;
    limit?: number;
    /** Wall-clock deadline (epoch ms). Posts not started by then are reported in `remaining`. */
    deadlineMs?: number;
  } = {},
): Promise<MetricsPollSummary> {
  const summary: MetricsPollSummary = { due: 0, polled: 0, channelFetches: 0, affectedDates: [], errors: [], remaining: 0 };
  const limit = Math.min(Math.max(opts.limit ?? 15, 1), MAX_REFRESH_POSTS);
  // Never reach past the backfill horizon: older posts have no poll state and
  // most platforms stop serving insights for them anyway.
  const floorIso = backfillSinceIso(nowIso);
  const sinceIso = opts.sinceIso && opts.sinceIso > floorIso ? opts.sinceIso : floorIso;
  const deadlineMs = opts.deadlineMs ?? Number.POSITIVE_INFINITY;

  let query: FirebaseFirestore.Query = adminDb
    .collection(`workspaces/${workspaceId}/posts`)
    .where('status', '==', 'published');
  if (opts.productId) query = query.where('productId', '==', opts.productId);
  query = query.where('publishedAt', '>=', sinceIso).orderBy('publishedAt', 'desc').limit(limit);

  const snap = await query.get();
  summary.due = snap.size;
  if (snap.empty) return summary;

  const connectionCache = new Map<string, PlatformConnection | null>();
  const authFlagged = new Set<string>();
  const refreshAttempted = new Set<string>();

  const refreshOne = async (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
    const post = doc.data() as PostDocData;
    // Posts the scheduler already parked (deleted on the platform, metrics
    // not offered, retry budget spent) are not worth another platform call,
    // and reporting them as failures on every press taught nobody anything.
    if (post.metricsStatus === 'unsupported' || post.metricsStatus === 'failed') {
      summary.skippedDead = (summary.skippedDead ?? 0) + 1;
      return;
    }
    const publishedAt = post.publishedAt || nowIso;
    let targets = publishedChannelTargets(post);
    if (opts.channel) targets = targets.filter((t) => t.channel === opts.channel);
    if (targets.length === 0) return;

    const { byChannel, outcomes, lastError, channelFetches } = await fetchPostChannelMetrics(
      post,
      targets,
      publishedAt,
      workspaceId,
      doc.id,
      connectionCache,
      authFlagged,
      refreshAttempted,
    );
    summary.channelFetches += channelFetches;

    if (!outcomes.includes('ok')) {
      // Every channel says the post is gone (deleted on the platform) or has
      // no metrics to offer. Park it now, exactly as the scheduler would, so
      // the next press does not fetch it again, and count it apart from real
      // failures: a post the user removed on Instagram is not a refresh error.
      const allDead = outcomes.length > 0 && outcomes.every((o) => o === 'unsupported' || o === 'not_found');
      if (allDead) {
        await doc.ref.update({
          metricsStatus: 'unsupported',
          metricsLastError: lastError || 'Metrics not available for this post',
          metricsNextPollAt: FieldValue.delete(),
          metricsUpdatedAt: nowIso,
        });
        summary.parked = (summary.parked ?? 0) + 1;
        return;
      }
      if (lastError) summary.errors.push({ postId: doc.id, error: lastError });
      return;
    }

    const stage = Math.min(post.metricsPollStage ?? 0, METRIC_POLL_STAGES.length - 1);
    const stageKey = METRIC_POLL_STAGES[stage].key;
    const snapshotRef = doc.ref.collection('metrics').doc(stageKey);
    await snapshotRef.set({
      postId: doc.id,
      stageKey,
      capturedAt: nowIso,
      publishedAt: post.publishedAt ?? null,
      byChannel,
    });
    await bookActivity(workspaceId, post, byChannel, nowIso, snapshotRef);
    // Only the denormalized latest-metrics fields are touched; the decaying
    // schedule (metricsPollStage / metricsNextPollAt / metricsStatus) is left
    // to the background poller so ad-hoc refreshes never rush the cadence.
    await doc.ref.update({
      metricsByChannel: byChannel,
      metricsUpdatedAt: nowIso,
      metricsLastError: lastError || FieldValue.delete(),
    });
    summary.polled++;
    const date = utcDateOf(publishedAt);
    if (!summary.affectedDates.includes(date)) summary.affectedDates.push(date);
  };

  // Light concurrency: a shared cursor consumed by a few workers. JS is
  // single-threaded, so the shared summary/cache mutations need no locking.
  const docs = snap.docs;
  let cursor = 0;
  const REFRESH_CONCURRENCY = 5;
  const worker = async () => {
    while (cursor < docs.length) {
      // Stop taking new posts once the budget is spent; in-flight fetches
      // finish so a half-written post never lands.
      if (Date.now() >= deadlineMs) return;
      const doc = docs[cursor++];
      try {
        await refreshOne(doc);
      } catch (err) {
        summary.errors.push({ postId: doc.id, error: err instanceof Error ? err.message : 'unknown' });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(REFRESH_CONCURRENCY, docs.length) }, () => worker()),
  );
  summary.remaining = Math.max(0, docs.length - cursor);

  return summary;
}

/**
 * Initialize poll state on published posts that don't have it yet. Used both
 * for the one-time 90-day backfill and the recurring sweep that catches
 * freshly published posts (whatever code path marked them published).
 */
export async function initPollStateForRecentPosts(
  workspaceId: string,
  nowIso: string,
  options: { sinceIso: string },
): Promise<number> {
  const now = Date.parse(nowIso);
  const docs = await getAllMatchingDocs(
    adminDb
      .collection(`workspaces/${workspaceId}/posts`)
      .where('status', '==', 'published')
      .where('publishedAt', '>=', options.sinceIso),
  );

  let initialized = 0;
  let batch = adminDb.batch();
  let batchSize = 0;

  for (const doc of docs) {
    const post = doc.data() as PostDocData;
    if (post.metricsStatus || post.metricsNextPollAt) continue;
    const publishedAt = post.publishedAt;
    if (!publishedAt) continue;
    const state = initialPollState(publishedAt, now);
    batch.update(doc.ref, {
      metricsStatus: 'active',
      metricsPollStage: state.stage,
      metricsNextPollAt: state.nextAt,
      metricsAttempts: 0,
    });
    initialized++;
    batchSize++;
    if (batchSize >= 400) {
      await batch.commit();
      batch = adminDb.batch();
      batchSize = 0;
    }
  }
  if (batchSize > 0) await batch.commit();

  if (initialized > 0) {
    logger.info('metrics poll state initialized', {
      event: 'analytics.poll_state_init',
      workspaceId,
      initialized,
      since: options.sinceIso,
    });
  }
  return initialized;
}

export function backfillSinceIso(nowIso: string): string {
  return new Date(Date.parse(nowIso) - METRICS_BACKFILL_DAYS * 24 * 3600_000).toISOString();
}

/**
 * Re-activate posts previously parked as 'unsupported' or 'failed' so they
 * get another metrics attempt. Missing-scope errors park posts permanently;
 * once the user reconnects the channel with the new insights scopes, this
 * daily pass picks those posts back up (genuinely unsupported posts simply
 * get re-parked after one cheap fetch).
 */
export async function retryDeadMetricsPosts(workspaceId: string, nowIso: string): Promise<number> {
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/posts`)
    .where('status', '==', 'published')
    .where('metricsStatus', 'in', ['unsupported', 'failed'])
    .where('publishedAt', '>=', backfillSinceIso(nowIso))
    .limit(300)
    .get();
  if (snap.empty) return 0;

  const now = Date.parse(nowIso);
  let batch = adminDb.batch();
  let batchSize = 0;
  for (const doc of snap.docs) {
    const post = doc.data() as PostDocData;
    if (!post.publishedAt) continue;
    const state = initialPollState(post.publishedAt, now);
    batch.update(doc.ref, {
      metricsStatus: 'active',
      metricsPollStage: state.stage,
      metricsNextPollAt: state.nextAt,
      metricsAttempts: 0,
    });
    batchSize++;
    if (batchSize >= 400) {
      await batch.commit();
      batch = adminDb.batch();
      batchSize = 0;
    }
  }
  if (batchSize > 0) await batch.commit();

  logger.info('dead metrics posts re-activated', {
    event: 'analytics.dead_retry',
    workspaceId,
    reactivated: snap.size,
  });
  return snap.size;
}
