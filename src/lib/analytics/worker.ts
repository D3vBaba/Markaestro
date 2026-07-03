import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { captureAudienceSnapshots } from './audience';
import { recomputeDailyAggregates } from './aggregates';
import {
  backfillSinceIso,
  initPollStateForRecentPosts,
  pollDueMetrics,
} from './metrics-poller';
import { ANALYTICS_META_PATH, utcDateOf, type AnalyticsMetaDoc } from './types';

/** How often the sweep for freshly published posts runs. */
const SWEEP_INTERVAL_MS = 5 * 60_000;
/** The sweep only needs to look as far back as publishes it could have missed. */
const SWEEP_WINDOW_MS = 48 * 3600_000;
/** How long to wait before retrying a day's audience capture that had errors. */
const AUDIENCE_RETRY_MS = 3600_000;

export type AnalyticsTickResult = {
  backfilled?: number;
  swept?: number;
  polled: number;
  aggregatedDates: number;
  audienceCaptured?: number;
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

  if (Object.keys(metaUpdate).length > 0) {
    metaUpdate.updatedAt = nowIso;
    await metaRef.set(metaUpdate, { merge: true });
  }

  if (result.polled > 0 || result.errors.length > 0 || result.backfilled || result.audienceCaptured) {
    logger.info('analytics tick completed', {
      event: 'analytics.tick',
      workspaceId,
      ...result,
      errors: result.errors.length,
    });
  }
  return result;
}
