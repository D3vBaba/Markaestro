/**
 * Per-workspace worker tick.
 *
 * This is the fan-out unit: a single workspace's share of the scheduled
 * work that used to all run inside the dispatcher. Pulling it into a
 * standalone module lets us:
 *
 *   1. Preserve bounded in-process execution as an operational fallback.
 *   2. Expose a dedicated endpoint (POST /api/worker/workspace/[id]) that
 *      Cloud Tasks can hit once per due workspace.
 *
 * The dispatcher normally reads the top-level due-workspace queue and sends
 * this unit to Cloud Tasks. A periodic legacy sweep remains as a compatibility
 * net for old records and any writer that has not marked its workspace yet.
 */

import { adminDb } from '@/lib/firebase-admin';
import { executeJob } from '@/lib/jobs/executor';
import { processScheduledPosts, recoverStalePublishingPosts } from '@/lib/social/publisher';
import { getAllMatchingDocs } from '@/lib/firestore-pagination';
import { processQueuedPublicPublishRuns } from '@/lib/public-api/publish-runs';
import { processPendingWebhookDeliveries } from '@/lib/public-api/webhook-delivery';
import { processPendingMediaAssets } from '@/lib/media/pipeline';
import { processAnalyticsTick, type AnalyticsTickResult } from '@/lib/analytics/worker';
import { logger } from '@/lib/logger';
import { sweepOrphanedMediaAssets } from '@/lib/media/asset-store';
import { markWorkspaceDue, type WorkspaceWorkReason } from './due-workspaces';
import { processIntelligenceJobs } from '@/lib/intelligence/fingerprints';
import { processDueExperiments } from '@/lib/intelligence/experiment-lifecycle';
import { runQuarterlyCapabilityAuditIfDue } from '@/lib/platform/capability-audit';
import { notifyUnreadyChannelsForUpcomingPosts, type ChannelHealthNoticeResult } from '@/lib/channel-health-emails';
import {
  emitAiBurnSlo,
  emitChannelHealthSlo,
  emitPublishSlo,
  emitMetricsStalenessSlo,
  emitWebhookDeliverySlo,
} from '@/lib/observability/slo-metrics';
import {
  countOverdueMetricsPolls,
  readAiOperationBurn,
  sampleChannelHealth,
} from '@/lib/observability/slo-inputs';

export type WorkspaceTickResult = {
  workspaceId: string;
  durationMs: number;
  scheduledPosts?: {
    claimed: number;
    processed: number;
    published: number;
    pending: number;
    retried: number;
    failed: number;
    recovered: number;
  };
  publicPublishRuns: Array<{ runId: string; status: string }>;
  webhookDeliveries: Array<{ deliveryId: string; status: string }>;
  jobsScanned: number;
  jobsProcessed: number;
  intelligenceJobs?: { processed: number; failed: number };
  experiments?: { scanned: number; closed: number };
  mediaSweep?: { scanned: number; deleted: number; bytesReleased: number; skipped: number };
  channelHealth?: ChannelHealthNoticeResult;
  jobResults: Array<{ jobId: string } & Record<string, unknown>>;
  analytics?: AnalyticsTickResult;
  errors: Array<{ kind: string; postId?: string; error: string }>;
};

type NextWork = { dueAt: string; reason: WorkspaceWorkReason };

async function firstDueAt(
  query: FirebaseFirestore.Query,
  field: string,
  reason: WorkspaceWorkReason,
): Promise<NextWork | null> {
  try {
    const snap = await query.limit(1).get();
    const value = snap.docs[0]?.data()?.[field];
    return typeof value === 'string' && Number.isFinite(Date.parse(value))
      ? { dueAt: value, reason }
      : null;
  } catch (error) {
    logger.warn('next workspace due query failed; compatibility sweep will retry', {
      event: 'worker.next_due_query_failed',
      reason,
      err: error,
    });
    return null;
  }
}

async function scheduleNextWorkspaceWork(workspaceId: string): Promise<void> {
  const [scheduledPost, publishRun, webhookDelivery, analytics, dailyJob, experimentClose] = await Promise.all([
    firstDueAt(
      adminDb.collection(`workspaces/${workspaceId}/posts`)
        .where('status', '==', 'scheduled')
        .orderBy('scheduledAt', 'asc'),
      'scheduledAt',
      'scheduled_post',
    ),
    firstDueAt(
      adminDb.collection(`workspaces/${workspaceId}/job_runs`)
        .where('type', '==', 'publish_post')
        .where('status', '==', 'queued')
        .orderBy('nextAttemptAt', 'asc'),
      'nextAttemptAt',
      'publish_run',
    ),
    firstDueAt(
      adminDb.collection(`workspaces/${workspaceId}/webhook_deliveries`)
        .where('status', 'in', ['pending', 'retrying'])
        .orderBy('nextAttemptAt', 'asc'),
      'nextAttemptAt',
      'webhook_delivery',
    ),
    firstDueAt(
      adminDb.collection(`workspaces/${workspaceId}/posts`)
        .where('status', '==', 'published')
        .orderBy('metricsNextPollAt', 'asc'),
      'metricsNextPollAt',
      'analytics',
    ),
    firstDueAt(
      adminDb.collection(`workspaces/${workspaceId}/jobs`)
        .where('enabled', '==', true)
        .where('schedule', '==', 'daily')
        .orderBy('nextRunAt', 'asc'),
      'nextRunAt',
      'daily_job',
    ),
    firstDueAt(
      adminDb.collection(`workspaces/${workspaceId}/experiments`)
        .where('status', 'in', ['scheduled', 'running'])
        .orderBy('endsAt', 'asc'),
      'endsAt',
      'experiment_close',
    ),
  ]);

  const next = [scheduledPost, publishRun, webhookDelivery, analytics, dailyJob, experimentClose]
    .filter((candidate): candidate is NextWork => candidate !== null)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0];
  if (next) await markWorkspaceDue(workspaceId, next.dueAt, next.reason);
}

export async function processWorkspaceTick(workspaceId: string): Promise<WorkspaceTickResult> {
  const startedAt = Date.now();
  const nowIso = new Date().toISOString();
  const errors: WorkspaceTickResult['errors'] = [];
  const publicPublishRuns: WorkspaceTickResult['publicPublishRuns'] = [];
  const webhookDeliveries: WorkspaceTickResult['webhookDeliveries'] = [];
  const jobResults: WorkspaceTickResult['jobResults'] = [];
  let scheduledPosts: WorkspaceTickResult['scheduledPosts'];
  let jobsScanned = 0;
  let intelligenceJobs: WorkspaceTickResult['intelligenceJobs'];
  let mediaSweep: WorkspaceTickResult['mediaSweep'];

  try {
    const staleRecovery = await recoverStalePublishingPosts(workspaceId);
    staleRecovery.errors.forEach((e) => errors.push({ kind: 'stale-recovery', postId: e.postId, error: e.error }));
    const postResult = await processScheduledPosts(workspaceId);
    postResult.errors.forEach((e) => errors.push({ kind: 'scheduled-post', postId: e.postId, error: e.error }));
    if (postResult.processed > 0 || staleRecovery.recovered > 0 || staleRecovery.failed > 0) {
      scheduledPosts = {
        claimed: postResult.claimed,
        processed: postResult.processed,
        published: postResult.published,
        pending: postResult.pending,
        retried: postResult.retried,
        failed: postResult.failed + staleRecovery.failed,
        recovered: staleRecovery.recovered,
      };
    }
    emitPublishSlo({
      workspaceId,
      attempted: postResult.processed,
      failed: postResult.failed + staleRecovery.failed,
      published: postResult.published,
      retried: postResult.retried,
    });
  } catch (err) {
    errors.push({ kind: 'scheduled-post', error: err instanceof Error ? err.message : 'unknown' });
  }

  try {
    const results = await processQueuedPublicPublishRuns(workspaceId);
    for (const r of results) publicPublishRuns.push({ runId: r.runId, status: r.status });
  } catch (err) {
    errors.push({ kind: 'public-publish', error: err instanceof Error ? err.message : 'unknown' });
  }

  try {
    const deliveries = await processPendingWebhookDeliveries(workspaceId);
    for (const d of deliveries) webhookDeliveries.push({ deliveryId: d.deliveryId, status: d.status });
    emitWebhookDeliverySlo({
      workspaceId,
      attempted: deliveries.length,
      delivered: deliveries.filter((d) => d.status === 'delivered').length,
      // Terminal outcomes only. `dead_letter` is the exhausted-retries state
      // (replayable for a week); `failed` remains for the endpoint-gone case.
      // Retrying deliveries are not counted, since they may still succeed.
      deadLettered: deliveries.filter((d) => d.status === 'dead_letter' || d.status === 'failed').length,
    });
  } catch (err) {
    errors.push({ kind: 'webhook-delivery', error: err instanceof Error ? err.message : 'unknown' });
  }

  try {
    // Collect media that lost its last reference more than the grace window
    // ago. Without this, deleting a post only marks its assets orphaned and
    // the storage is never actually returned to the workspace.
    const sweep = await sweepOrphanedMediaAssets(workspaceId);
    if (sweep.scanned > 0) mediaSweep = sweep;
  } catch (err) {
    errors.push({ kind: 'media-sweep', error: err instanceof Error ? err.message : 'unknown' });
  }

  try {
    // Derive thumbnails and dimensions for freshly uploaded assets (5.8),
    // outside any request path.
    const pipeline = await processPendingMediaAssets(workspaceId);
    pipeline.errors.forEach((e) => errors.push({ kind: 'media-pipeline', error: e.error }));
  } catch (err) {
    errors.push({ kind: 'media-pipeline', error: err instanceof Error ? err.message : 'unknown' });
  }

  let analytics: WorkspaceTickResult['analytics'];
  try {
    analytics = await processAnalyticsTick(workspaceId);
    analytics.errors.forEach((e) => errors.push({ kind: e.kind, error: e.error }));
  } catch (err) {
    errors.push({ kind: 'analytics', error: err instanceof Error ? err.message : 'unknown' });
  }

  try {
    const jobsDocs = await getAllMatchingDocs(
      adminDb
        .collection(`workspaces/${workspaceId}/jobs`)
        .where('enabled', '==', true)
        .where('schedule', '==', 'daily'),
    );
    jobsScanned = jobsDocs.length;

    for (const j of jobsDocs) {
      const d = j.data();
      if (d.nextRunAt && String(d.nextRunAt) > nowIso) continue;
      const r = await executeJob(workspaceId, j.id, d as Parameters<typeof executeJob>[2]);
      jobResults.push({ jobId: j.id, ...r });
    }
  } catch (err) {
    errors.push({ kind: 'jobs', error: err instanceof Error ? err.message : 'unknown' });
  }

  try {
    intelligenceJobs = await processIntelligenceJobs(workspaceId, nowIso);
    if (intelligenceJobs.failed) {
      errors.push({ kind: 'intelligence-jobs', error: `${intelligenceJobs.failed} job(s) deferred` });
    }
  } catch (err) {
    errors.push({ kind: 'intelligence-jobs', error: err instanceof Error ? err.message : 'unknown' });
  }

  let experiments: WorkspaceTickResult['experiments'];
  try {
    experiments = await processDueExperiments(workspaceId, new Date(nowIso));
  } catch (err) {
    errors.push({ kind: 'experiments', error: err instanceof Error ? err.message : 'unknown' });
  }

  try {
    await runQuarterlyCapabilityAuditIfDue(new Date(nowIso));
  } catch (err) {
    errors.push({ kind: 'capability-audit', error: err instanceof Error ? err.message : 'unknown' });
  }

  // Warn about channels that posts scheduled in the next 24 hours depend on
  // and cannot use. Own try/catch: the notifier already swallows its own
  // failures, and a warning must never cost the tick its remaining work.
  let channelHealth: WorkspaceTickResult['channelHealth'];
  try {
    channelHealth = await notifyUnreadyChannelsForUpcomingPosts(workspaceId, new Date(nowIso));
  } catch (err) {
    errors.push({ kind: 'channel-health', error: err instanceof Error ? err.message : 'unknown' });
  }

  // Domain SLO counters. These are the alerts that fire when the product is
  // failing while the infrastructure stays green, which is what every Phase 1
  // bug looked like from the outside. See docs/operations/alerting.md.
  try {
    const [staleness, aiBurn, channels] = await Promise.all([
      countOverdueMetricsPolls(workspaceId, new Date(nowIso)),
      readAiOperationBurn(workspaceId, new Date(nowIso)),
      sampleChannelHealth(workspaceId),
    ]);
    emitMetricsStalenessSlo({
      workspaceId,
      overdue: staleness.overdue,
      graceHours: staleness.graceHours,
    });
    emitAiBurnSlo({
      workspaceId,
      operationsThisMonth: aiBurn.operationsThisMonth,
      monthlyLimit: aiBurn.monthlyLimit,
    });
    emitChannelHealthSlo({
      workspaceId,
      unhealthy: channels.unhealthy,
      degradedTokens: channels.degradedTokens,
    });
  } catch (err) {
    errors.push({ kind: 'slo-counters', error: err instanceof Error ? err.message : 'unknown' });
  }

  try {
    await scheduleNextWorkspaceWork(workspaceId);
  } catch (err) {
    errors.push({ kind: 'next-work', error: err instanceof Error ? err.message : 'unknown' });
  }

  const durationMs = Date.now() - startedAt;
  logger.info('workspace-tick completed', {
    event: 'worker.workspace_tick',
    workspaceId,
    durationMs,
    errors: errors.length,
    jobsProcessed: jobResults.length,
    intelligenceJobs,
  });

  return {
    workspaceId,
    durationMs,
    scheduledPosts,
    publicPublishRuns,
    webhookDeliveries,
    jobsScanned,
    jobsProcessed: jobResults.length,
    jobResults,
    analytics,
    intelligenceJobs,
    experiments,
    mediaSweep,
    channelHealth,
    errors,
  };
}

/**
 * Run `fn` over `items` with a maximum of `concurrency` in flight at once.
 * Never rejects — returns settled results so one slow/broken workspace
 * can't abort the whole batch.
 */
export async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<U>,
): Promise<PromiseSettledResult<U>[]> {
  const results: PromiseSettledResult<U>[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        const value = await fn(items[i]);
        results[i] = { status: 'fulfilled', value };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
