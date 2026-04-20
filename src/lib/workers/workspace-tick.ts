/**
 * Per-workspace worker tick.
 *
 * This is the fan-out unit: a single workspace's share of the scheduled
 * work that used to all run inside the dispatcher. Pulling it into a
 * standalone module lets us:
 *
 *   1. Run multiple workspaces with bounded concurrency in the
 *      dispatcher (see mapWithConcurrency below) so one slow workspace
 *      can't starve the rest.
 *   2. Expose it as a dedicated endpoint (POST /api/worker/workspace/[id])
 *      that Cloud Tasks can hit once per workspace, turning the tick
 *      into a true distributed job queue.
 *
 * The dispatcher (/api/worker/tick) enumerates active workspaces and,
 * depending on the WORKER_FANOUT_MODE env var, either calls this module
 * directly with p-limit concurrency or enqueues per-workspace tasks.
 */

import { adminDb } from '@/lib/firebase-admin';
import { executeJob } from '@/lib/jobs/executor';
import { processScheduledPosts, recoverStalePublishingPosts } from '@/lib/social/publisher';
import { getAllMatchingDocs } from '@/lib/firestore-pagination';
import { processQueuedPublicPublishRuns } from '@/lib/public-api/publish-runs';
import { processPendingWebhookDeliveries } from '@/lib/public-api/webhook-delivery';
import { logger } from '@/lib/logger';

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
  jobResults: Array<{ jobId: string } & Record<string, unknown>>;
  errors: Array<{ kind: string; postId?: string; error: string }>;
};

export async function processWorkspaceTick(workspaceId: string): Promise<WorkspaceTickResult> {
  const startedAt = Date.now();
  const nowIso = new Date().toISOString();
  const errors: WorkspaceTickResult['errors'] = [];
  const publicPublishRuns: WorkspaceTickResult['publicPublishRuns'] = [];
  const webhookDeliveries: WorkspaceTickResult['webhookDeliveries'] = [];
  const jobResults: WorkspaceTickResult['jobResults'] = [];
  let scheduledPosts: WorkspaceTickResult['scheduledPosts'];
  let jobsScanned = 0;

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
  } catch (err) {
    errors.push({ kind: 'webhook-delivery', error: err instanceof Error ? err.message : 'unknown' });
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

  const durationMs = Date.now() - startedAt;
  logger.info('workspace-tick completed', {
    event: 'worker.workspace_tick',
    workspaceId,
    durationMs,
    errors: errors.length,
    jobsProcessed: jobResults.length,
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
