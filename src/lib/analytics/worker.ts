import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { captureAudienceSnapshots } from './audience';
import { recomputeDailyAggregates } from './aggregates';
import {
  backfillSinceIso,
  initPollStateForRecentPosts,
  pollDueMetrics,
  retryDeadMetricsPosts,
} from './metrics-poller';
import { ANALYTICS_META_PATH, utcDateOf, type AnalyticsMetaDoc } from './types';
import { importRecentNativePosts, type NativeImportResult } from '@/lib/intelligence/native-import';
import { loadProductIntelligence, loadAudienceSnapshots } from '@/lib/intelligence/product-state';
import { isIntelligencePhaseEnabled } from '@/lib/intelligence/feature-flags';
import { backfillLegacySocialPosts, type LegacySocialPostBackfillResult } from '@/lib/intelligence/legacy-post-backfill';
import { enqueuePublishedPostFingerprints, type FingerprintBackfillResult } from '@/lib/intelligence/published-post-fingerprints';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';

/** How often the sweep for freshly published posts runs. */
const SWEEP_INTERVAL_MS = 5 * 60_000;
/** The sweep only needs to look as far back as publishes it could have missed. */
const SWEEP_WINDOW_MS = 48 * 3600_000;
/** How long to wait before retrying a day's audience capture that had errors. */
const AUDIENCE_RETRY_MS = 3600_000;
/**
 * Insights are derived from a workspace's whole post/snapshot history, so the
 * recompute costs thousands of reads per workspace. The inputs move on the
 * order of a publish or a daily snapshot, not a tick — recompute hourly.
 */
const LEARNING_RECOMPUTE_INTERVAL_MS = 3600_000;

export type AnalyticsTickResult = {
  backfilled?: number;
  swept?: number;
  polled: number;
  aggregatedDates: number;
  audienceCaptured?: number;
  deadRetried?: number;
  nativeImport?: NativeImportResult;
  legacySocialPosts?: LegacySocialPostBackfillResult;
  fingerprints?: FingerprintBackfillResult;
  errors: Array<{ kind: string; error: string }>;
};

/**
 * Per-workspace analytics step of the worker tick:
 *  1. one-time 90-day backfill of poll state for already-published posts
 *  2. recurring sweep initializing poll state on freshly published posts
 *  3. fetch metrics for due posts (decaying schedule)
 *  4. recompute daily rollups for dates whose posts got new metrics
 *  5. once per UTC day, snapshot follower counts per connected account
 */
export async function processAnalyticsTick(workspaceId: string): Promise<AnalyticsTickResult> {
  const nowIso = new Date().toISOString();
  const today = utcDateOf(nowIso);
  const result: AnalyticsTickResult = { polled: 0, aggregatedDates: 0, errors: [] };

  const metaRef = adminDb.doc(ANALYTICS_META_PATH(workspaceId));
  const metaSnap = await metaRef.get();
  const meta = (metaSnap.exists ? metaSnap.data() : {}) as AnalyticsMetaDoc;
  const metaUpdate: AnalyticsMetaDoc = {};

  try {
    if (!meta.metricsBackfillAt) {
      result.backfilled = await initPollStateForRecentPosts(workspaceId, nowIso, {
        sinceIso: backfillSinceIso(nowIso),
      });
      metaUpdate.metricsBackfillAt = nowIso;
      metaUpdate.lastSweepAt = nowIso;
    } else if (!meta.lastSweepAt || Date.parse(nowIso) - Date.parse(meta.lastSweepAt) > SWEEP_INTERVAL_MS) {
      // Reach back to before the last successful sweep (worker downtime can
      // exceed the 48h window), never further than the backfill horizon.
      const sweepFloor = Date.parse(nowIso) - SWEEP_WINDOW_MS;
      const lastSweepMs = meta.lastSweepAt ? Date.parse(meta.lastSweepAt) - 3600_000 : sweepFloor;
      const sinceMs = Math.max(
        Math.min(sweepFloor, lastSweepMs),
        Date.parse(backfillSinceIso(nowIso)),
      );
      result.swept = await initPollStateForRecentPosts(workspaceId, nowIso, {
        sinceIso: new Date(sinceMs).toISOString(),
      });
      metaUpdate.lastSweepAt = nowIso;
    }
  } catch (err) {
    result.errors.push({ kind: 'metrics-init', error: err instanceof Error ? err.message : 'unknown' });
  }

  try {
    const poll = await pollDueMetrics(workspaceId, nowIso);
    result.polled = poll.polled;
    poll.errors.forEach((e) => result.errors.push({ kind: 'metrics-poll', error: `${e.postId}: ${e.error}` }));

    if (poll.affectedDates.length > 0) {
      result.aggregatedDates = await recomputeDailyAggregates(workspaceId, poll.affectedDates);
    }
  } catch (err) {
    result.errors.push({ kind: 'metrics-poll', error: err instanceof Error ? err.message : 'unknown' });
  }

  try {
    const attemptedRecently = meta.lastAudienceAttemptAt
      && Date.parse(nowIso) - Date.parse(meta.lastAudienceAttemptAt) < AUDIENCE_RETRY_MS;
    if (meta.lastAudienceDate !== today && !attemptedRecently) {
      const audience = await captureAudienceSnapshots(workspaceId, today, nowIso);
      result.audienceCaptured = audience.captured;
      audience.errors.forEach((e) => result.errors.push({ kind: 'audience', error: `${e.channel}: ${e.error}` }));
      // Only stamp the day complete when every account succeeded; otherwise
      // retry hourly so a flaky platform doesn't leave a hole in the trend.
      if (audience.errors.length === 0) {
        metaUpdate.lastAudienceDate = today;
      } else {
        metaUpdate.lastAudienceAttemptAt = nowIso;
      }
    }
  } catch (err) {
    result.errors.push({ kind: 'audience', error: err instanceof Error ? err.message : 'unknown' });
  }

  try {
    if (meta.metricsBackfillAt && meta.lastDeadRetryDate !== today) {
      result.deadRetried = await retryDeadMetricsPosts(workspaceId, nowIso);
      metaUpdate.lastDeadRetryDate = today;
    }
  } catch (err) {
    result.errors.push({ kind: 'metrics-retry', error: err instanceof Error ? err.message : 'unknown' });
  }

  try {
    const nativeImportEnabled = await isIntelligencePhaseEnabled({
      phase: 'foundation',
      workspaceId,
      uid: 'system',
      entitled: true,
      includeShadow: true,
    });
    if (nativeImportEnabled && !meta.socialPostsBackfillAt) {
      const page = await backfillLegacySocialPosts(workspaceId, nowIso, {
        afterId: meta.socialPostsBackfillAfterId,
      });
      result.legacySocialPosts = page;
      if (page.done) {
        metaUpdate.socialPostsBackfillAt = nowIso;
      } else if (page.lastId) {
        metaUpdate.socialPostsBackfillAfterId = page.lastId;
      }
    }
    if (nativeImportEnabled) {
      result.nativeImport = await importRecentNativePosts(workspaceId, nowIso);
      result.nativeImport.errors.forEach((error) => result.errors.push({
        kind: 'native-import',
        error: `${error.connectionId}: ${error.error}`,
      }));
    }
    const learningPhase = await isIntelligencePhaseEnabled({
      phase: 'learning',
      workspaceId,
      uid: 'system',
      entitled: true,
      includeShadow: true,
    });
    if (learningPhase) {
      // Caption fingerprints for published posts feed pattern learnings and
      // "why it worked". Bounded per tick and per day; see the module header.
      const fingerprints = await enqueuePublishedPostFingerprints(workspaceId, nowIso, meta);
      result.fingerprints = fingerprints.result;
      Object.assign(metaUpdate, fingerprints.metaUpdate);
      if (fingerprints.result.queued > 0) {
        await markWorkspaceDue(workspaceId, new Date(), 'intelligence_job').catch(() => undefined);
      }
    }
    const learningDue = !meta.lastLearningRecomputeAt
      || Date.parse(nowIso) - Date.parse(meta.lastLearningRecomputeAt) >= LEARNING_RECOMPUTE_INTERVAL_MS;
    if (learningPhase && learningDue) {
      const products = await adminDb.collection(`workspaces/${workspaceId}/products`).select().limit(8).get();
      // One workspace-wide snapshot read shared by every product: the query has
      // no productId filter, so per-product reads would return the same docs.
      const snapshots = products.empty ? [] : await loadAudienceSnapshots(workspaceId);
      for (const product of products.docs) {
        // Full recompute writes the cache, so the page read path stays cheap.
        await loadProductIntelligence(workspaceId, product.id, { audienceSnapshots: snapshots, persist: true });
      }
      metaUpdate.lastLearningRecomputeAt = nowIso;
    }
  } catch (err) {
    result.errors.push({ kind: 'intelligence-ingest', error: err instanceof Error ? err.message : 'unknown' });
  }

  if (Object.keys(metaUpdate).length > 0) {
    metaUpdate.updatedAt = nowIso;
    await metaRef.set(metaUpdate, { merge: true });
  }

  if (result.polled > 0 || result.errors.length > 0 || result.backfilled || result.audienceCaptured || result.legacySocialPosts || result.fingerprints?.queued) {
    logger.info('analytics tick completed', {
      event: 'analytics.tick',
      workspaceId,
      ...result,
      errors: result.errors.length,
    });
  }
  return result;
}
