import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getAllMatchingDocs } from '@/lib/firestore-pagination';
import { getAdapterForChannel } from '@/lib/platform/registry';
import { getConnectionForChannel, updateConnectionStatus } from '@/lib/platform/connections';
import type { NormalizedPostMetrics, PlatformConnection } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import { logger } from '@/lib/logger';
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
};

type PublishResultEntry = {
  channel?: string;
  success?: boolean;
  externalId?: string;
};

type PostDocData = {
  channel?: string;
  externalId?: string;
  productId?: string;
  destinationId?: string;
  destinationProvider?: string;
  publishedAt?: string;
  publishResults?: PublishResultEntry[];
  metricsByChannel?: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
  metricsPollStage?: number;
  metricsAttempts?: number;
  metricsStatus?: string;
  metricsNextPollAt?: string;
};

/** The published channel targets (channel + platform post ID) of a post. */
function publishTargets(post: PostDocData): Array<{ channel: SocialChannel; externalId: string }> {
  const targets = new Map<string, { channel: SocialChannel; externalId: string }>();
  for (const entry of post.publishResults ?? []) {
    if (entry.success && entry.channel && entry.externalId) {
      targets.set(entry.channel, { channel: entry.channel as SocialChannel, externalId: entry.externalId });
    }
  }
  if (targets.size === 0 && post.channel && post.externalId) {
    targets.set(post.channel, { channel: post.channel as SocialChannel, externalId: post.externalId });
  }
  return [...targets.values()];
}

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

  for (const doc of dueSnap.docs) {
    try {
      await pollOnePost(doc, workspaceId, nowIso, now, connectionCache, authFlagged, summary);
    } catch (err) {
      // One flaky post/write must not stall the rest of the batch; the post
      // stays due and is retried next tick.
      summary.errors.push({ postId: doc.id, error: err instanceof Error ? err.message : 'unknown' });
    }
  }

  return summary;
}

async function pollOnePost(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  workspaceId: string,
  nowIso: string,
  now: number,
  connectionCache: Map<string, PlatformConnection | null>,
  authFlagged: Set<string>,
  summary: MetricsPollSummary,
): Promise<void> {
  const post = doc.data() as PostDocData;
  const postRef = doc.ref;
  const publishedAt = post.publishedAt || nowIso;
  const stage = Math.min(post.metricsPollStage ?? 0, METRIC_POLL_STAGES.length - 1);
  const stageKey = METRIC_POLL_STAGES[stage].key;
  const targets = publishTargets(post);

  if (targets.length === 0) {
    await postRef.update({
      metricsStatus: 'unsupported',
      metricsLastError: 'No platform post ID recorded at publish time',
      metricsNextPollAt: FieldValue.delete(),
      metricsUpdatedAt: nowIso,
    });
    return;
  }

  const byChannel: Partial<Record<SocialChannel, NormalizedPostMetrics>> = { ...(post.metricsByChannel ?? {}) };
  const outcomes: Array<'ok' | 'auth' | 'not_found' | 'unsupported' | 'transient'> = [];
  let lastError = '';

  for (const target of targets) {
    const adapter = getAdapterForChannel(target.channel);
    if (!adapter?.fetchMetrics) {
      outcomes.push('unsupported');
      continue;
    }

    const cacheKey = `${target.channel}:${post.productId || ''}`;
    let connection = connectionCache.get(cacheKey);
    if (connection === undefined) {
      connection = await getConnectionForChannel(
        workspaceId,
        target.channel,
        post.productId || undefined,
        post.destinationProvider || undefined,
      );
      connectionCache.set(cacheKey, connection);
    }
    if (!connection) {
      outcomes.push('transient');
      lastError = `No connected ${target.channel} account`;
      continue;
    }

    summary.channelFetches++;
    const result = await adapter.fetchMetrics(connection, {
      channel: target.channel,
      externalId: target.externalId,
      publishedAt,
      destinationId: post.destinationId,
    });

    if (result.ok) {
      byChannel[target.channel] = result.metrics;
      outcomes.push('ok');
    } else {
      outcomes.push(result.reason);
      lastError = result.error;
      if (result.reason === 'auth') {
        // Surface token problems on the connection (integration status
        // machine) so the channel shows a health warning — but only once
        // per connection per tick.
        const flagKey = `${connection.provider}:${connection.productId || ''}`;
        if (!authFlagged.has(flagKey)) {
          authFlagged.add(flagKey);
          try {
            await updateConnectionStatus(workspaceId, connection.provider, 'error', connection.productId);
          } catch { /* connection doc may be gone; the poll retry covers it */ }
        }
      }
    }
  }

  const anyOk = outcomes.includes('ok');
  const allDead = outcomes.every((o) => o === 'unsupported' || o === 'not_found');
  const hasRetryableError = outcomes.some((o) => o === 'auth' || o === 'transient');

  if (anyOk) {
    await postRef.collection('metrics').doc(stageKey).set({
      postId: doc.id,
      stageKey,
      capturedAt: nowIso,
      publishedAt: post.publishedAt ?? null,
      byChannel,
    });
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
