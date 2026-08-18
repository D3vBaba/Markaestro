import { processTokenRefresh, cleanupExpiredOAuthStates } from '@/lib/oauth/token-refresh';
import { safeCompare } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { getAllDocs } from '@/lib/firestore-pagination';
import { processWorkspaceTick, mapWithConcurrency, type WorkspaceTickResult } from '@/lib/workers/workspace-tick';
import { logger, requestIdFromHeaders } from '@/lib/logger';
import { acquireWorkerLease, releaseWorkerLease } from '@/lib/workers/lease';
import {
  claimDueWorkspaces,
  claimPeriodicWorkerPhase,
  cloudTasksDispatchEnabled,
  completeWorkspaceDue,
  enqueueWorkspaceTask,
  releaseWorkspaceDueClaim,
  type DueWorkspaceClaim,
  type WorkspaceDispatch,
} from '@/lib/workers/due-workspaces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PER_WORKSPACE_CONCURRENCY = Number(process.env.WORKER_WS_CONCURRENCY || 8);
const MAX_DUE_WORKSPACES = Math.max(1, Number(process.env.WORKER_DUE_BATCH_SIZE || 50));
const LEGACY_SWEEP_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.WORKER_LEGACY_SWEEP_INTERVAL_MS || 5 * 60_000),
);
const GLOBAL_PHASE_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.WORKER_GLOBAL_PHASE_INTERVAL_MS || 15 * 60_000),
);

type DispatchOutcome = {
  dispatch: WorkspaceDispatch;
  mode: 'cloud_tasks' | 'in_process';
  result?: WorkspaceTickResult;
};

async function runWorkspaceInProcess(dispatch: WorkspaceDispatch): Promise<DispatchOutcome> {
  try {
    const result = await processWorkspaceTick(dispatch.workspaceId);
    if (dispatch.source === 'due') await completeWorkspaceDue(dispatch);
    return { dispatch, mode: 'in_process', result };
  } catch (error) {
    if (dispatch.source === 'due') {
      await releaseWorkspaceDueClaim(dispatch).catch(() => undefined);
    }
    throw error;
  }
}

async function dispatchWorkspace(dispatch: WorkspaceDispatch): Promise<DispatchOutcome> {
  if (cloudTasksDispatchEnabled()) {
    try {
      await enqueueWorkspaceTask(dispatch);
      return { dispatch, mode: 'cloud_tasks' };
    } catch (error) {
      logger.warn('Cloud Tasks enqueue failed; processing workspace in-process', {
        event: 'worker.cloud_tasks_enqueue_fallback',
        workspaceId: dispatch.workspaceId,
        err: error,
      });
    }
  }
  return runWorkspaceInProcess(dispatch);
}

function summarizeResults(results: WorkspaceTickResult[]) {
  const postResults = results.flatMap((result) => (
    result.scheduledPosts ? [{ workspaceId: result.workspaceId, ...result.scheduledPosts }] : []
  ));
  const postErrors = results.flatMap((result) => (
    result.errors.map((error) => ({
      workspaceId: result.workspaceId,
      postId: error.postId,
      error: error.error,
    }))
  ));
  const publicPublishResults = results.flatMap((result) => (
    result.publicPublishRuns.map((run) => ({ workspaceId: result.workspaceId, ...run }))
  ));
  const webhookResults = results.flatMap((result) => (
    result.webhookDeliveries.map((delivery) => ({ workspaceId: result.workspaceId, ...delivery }))
  ));
  const allJobResults = results.flatMap((result) => (
    result.jobResults.map((job) => ({ workspaceId: result.workspaceId, ...job }))
  ));
  return { postResults, postErrors, publicPublishResults, webhookResults, allJobResults };
}

export async function POST(req: Request) {
  const requestId = requestIdFromHeaders(req.headers);
  let leaseId: string | null = null;
  try {
    const secret = process.env.WORKER_SECRET || '';
    const token = req.headers.get('x-worker-secret') || '';
    if (!secret || !safeCompare(token, secret)) throw new Error('UNAUTHENTICATED');

    leaseId = await acquireWorkerLease('tick', 5 * 60_000);
    if (!leaseId) return apiOk({ ok: true, skipped: 'already_running', workspaces: 0 });

    const dueQueueEnabled = process.env.WORKER_DUE_QUEUE_ENABLED === '1';
    let tokenRefreshResult = {
      refreshed: 0,
      failed: 0,
      skipped: 0,
      errors: [] as Array<{ workspaceId: string; provider: string; error: string }>,
    };
    let statesCleanedUp = 0;
    const runGlobalPhases = !dueQueueEnabled
      || await claimPeriodicWorkerPhase('global', GLOBAL_PHASE_INTERVAL_MS);
    if (runGlobalPhases) {
      try {
        tokenRefreshResult = await processTokenRefresh();
      } catch (error) {
        logger.error('token refresh failed', { event: 'worker.token_refresh', requestId, err: error });
      }
      try {
        statesCleanedUp = await cleanupExpiredOAuthStates();
      } catch (error) {
        logger.error('oauth state cleanup failed', { event: 'worker.oauth_state_cleanup', requestId, err: error });
      }
    }

    const tickStart = Date.now();
    let dueClaims: DueWorkspaceClaim[] = [];
    let legacySweep = false;
    let dispatches: WorkspaceDispatch[] = [];

    if (dueQueueEnabled) {
      dueClaims = await claimDueWorkspaces(MAX_DUE_WORKSPACES);
      legacySweep = await claimPeriodicWorkerPhase('legacy-workspace-sweep', LEGACY_SWEEP_INTERVAL_MS);
      const dueIds = new Set(dueClaims.map((claim) => claim.workspaceId));
      const legacyDispatches = legacySweep
        ? (await getAllDocs('workspaces'))
            .filter((workspace) => !dueIds.has(workspace.id))
            .map((workspace) => ({ workspaceId: workspace.id, source: 'legacy' as const }))
        : [];
      dispatches = [...dueClaims, ...legacyDispatches];
    } else {
      dispatches = (await getAllDocs('workspaces'))
        .map((workspace) => ({ workspaceId: workspace.id, source: 'legacy' as const }));
      legacySweep = true;
    }

    const settled = await mapWithConcurrency(
      dispatches,
      PER_WORKSPACE_CONCURRENCY,
      dispatchWorkspace,
    );
    const outcomes = settled.flatMap((entry) => entry.status === 'fulfilled' ? [entry.value] : []);
    const fanoutFailures = settled
      .map((entry, index) => entry.status === 'rejected'
        ? { workspaceId: dispatches[index].workspaceId, reason: String(entry.reason) }
        : null)
      .filter((failure): failure is { workspaceId: string; reason: string } => failure !== null);
    const processedResults = outcomes.flatMap((outcome) => outcome.result ? [outcome.result] : []);
    const summary = summarizeResults(processedResults);
    const cloudTasksDispatched = outcomes.filter((outcome) => outcome.mode === 'cloud_tasks').length;

    logger.info('worker tick completed', {
      event: 'worker.tick',
      requestId,
      dueQueueEnabled,
      dueWorkspaces: dueClaims.length,
      legacySweep,
      dispatches: dispatches.length,
      cloudTasksDispatched,
      inProcess: processedResults.length,
      durationMs: Date.now() - tickStart,
      fanoutFailures: fanoutFailures.length,
      postErrors: summary.postErrors.length,
    });

    return apiOk({
      ok: true,
      workspaces: dispatches.length,
      dueWorkspaces: dueClaims.length,
      legacySweep,
      dispatched: cloudTasksDispatched,
      processedInProcess: processedResults.length,
      scanned: processedResults.reduce((count, result) => count + result.jobsScanned, 0),
      due: summary.allJobResults.length,
      processed: summary.allJobResults.length,
      results: summary.allJobResults,
      scheduledPosts: summary.postResults,
      scheduledPostErrors: summary.postErrors,
      fanoutFailures,
      tokenRefresh: tokenRefreshResult,
      oauthStatesCleanedUp: statesCleanedUp,
      publicPublishRuns: summary.publicPublishResults,
      webhookDeliveries: summary.webhookResults,
    });
  } catch (error) {
    return apiError(error);
  } finally {
    if (leaseId) {
      await releaseWorkerLease('tick', leaseId).catch((error) => {
        logger.warn('worker tick lease release failed', {
          event: 'worker.tick_lease_release_failed',
          requestId,
          err: error,
        });
      });
    }
  }
}
