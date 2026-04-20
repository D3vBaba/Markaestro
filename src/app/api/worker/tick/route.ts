import { pollPendingTikTokPublishes } from '@/lib/social/tiktok-publish-poll-worker';
import { processTokenRefresh, cleanupExpiredOAuthStates } from '@/lib/oauth/token-refresh';
import { safeCompare } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { getAllDocs } from '@/lib/firestore-pagination';
import { processWorkspaceTick, mapWithConcurrency } from '@/lib/workers/workspace-tick';
import { logger, requestIdFromHeaders } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Worker ticks can be long-running (sequential per-workspace work over
// hundreds of workspaces). Next.js/Cloud Run respect this upper bound.
export const maxDuration = 300;

/**
 * Bounded parallelism for per-workspace work. Chosen so one Cloud Run
 * instance with 1 vCPU + 1 GiB and Firestore-heavy per-workspace work
 * doesn't exhaust sockets, while still clearing ~60 workspaces per
 * ~20s tick. Tune up when instance size grows.
 */
const PER_WORKSPACE_CONCURRENCY = Number(process.env.WORKER_WS_CONCURRENCY || 8);

export async function POST(req: Request) {
  const requestId = requestIdFromHeaders(req.headers);
  try {
    const secret = process.env.WORKER_SECRET || '';
    const token = req.headers.get('x-worker-secret') || '';

    if (!secret || !safeCompare(token, secret)) {
      throw new Error('UNAUTHENTICATED');
    }

    // --- Global phases: cheap, run once per tick ---
    let tokenRefreshResult = { refreshed: 0, failed: 0, skipped: 0, errors: [] as Array<{ workspaceId: string; provider: string; error: string }> };
    try {
      tokenRefreshResult = await processTokenRefresh();
    } catch (e) {
      logger.error('token refresh failed', { event: 'worker.token_refresh', requestId, err: e });
    }

    let statesCleanedUp = 0;
    try {
      statesCleanedUp = await cleanupExpiredOAuthStates();
    } catch (e) {
      logger.error('oauth state cleanup failed', { event: 'worker.oauth_state_cleanup', requestId, err: e });
    }

    let tiktokPublishPollResult = { polled: 0, completed: 0, failed: 0, pending: 0, errors: [] as Array<{ workspaceId: string; postId: string; error: string }> };
    try {
      tiktokPublishPollResult = await pollPendingTikTokPublishes();
    } catch (e) {
      logger.error('tiktok publish polling failed', { event: 'worker.tiktok_publish_poll', requestId, err: e });
    }

    // --- Per-workspace fan-out ---
    // TODO: replace in-process fan-out with Cloud Tasks enqueue to the
    //       /api/worker/workspace/[id] endpoint for horizontal scale —
    //       see docs/operations/worker-fanout.md.
    const wsDocs = await getAllDocs('workspaces');
    const tickStart = Date.now();

    const settled = await mapWithConcurrency(
      wsDocs,
      PER_WORKSPACE_CONCURRENCY,
      (ws) => processWorkspaceTick(ws.id),
    );

    const tickResults = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    const fanoutFailures = settled
      .map((s, i) => (s.status === 'rejected' ? { workspaceId: wsDocs[i].id, reason: String(s.reason) } : null))
      .filter((x): x is { workspaceId: string; reason: string } => x !== null);

    const postResults = tickResults.flatMap((r) => (r.scheduledPosts ? [{ workspaceId: r.workspaceId, ...r.scheduledPosts }] : []));
    const postErrors = tickResults.flatMap((r) => r.errors.map((e) => ({ workspaceId: r.workspaceId, postId: e.postId, error: e.error })));
    const publicPublishResults = tickResults.flatMap((r) => r.publicPublishRuns.map((p) => ({ workspaceId: r.workspaceId, ...p })));
    const webhookResults = tickResults.flatMap((r) => r.webhookDeliveries.map((w) => ({ workspaceId: r.workspaceId, ...w })));
    const allJobResults = tickResults.flatMap((r) => r.jobResults.map((j) => ({ workspaceId: r.workspaceId, ...j })));

    logger.info('worker tick completed', {
      event: 'worker.tick',
      requestId,
      workspaces: wsDocs.length,
      durationMs: Date.now() - tickStart,
      fanoutFailures: fanoutFailures.length,
      postErrors: postErrors.length,
    });

    return apiOk({
      ok: true,
      workspaces: wsDocs.length,
      scanned: tickResults.reduce((n, r) => n + r.jobsScanned, 0),
      due: allJobResults.length,
      processed: allJobResults.length,
      results: allJobResults,
      scheduledPosts: postResults,
      scheduledPostErrors: postErrors,
      fanoutFailures,
      tokenRefresh: tokenRefreshResult,
      oauthStatesCleanedUp: statesCleanedUp,
      tiktokPublishes: tiktokPublishPollResult,
      publicPublishRuns: publicPublishResults,
      webhookDeliveries: webhookResults,
    });
  } catch (error) {
    return apiError(error);
  }
}
