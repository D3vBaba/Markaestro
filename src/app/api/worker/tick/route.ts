import { adminDb } from '@/lib/firebase-admin';
import { executeJob } from '@/lib/jobs/executor';
import { processScheduledPosts, recoverStalePublishingPosts } from '@/lib/social/publisher';
import { pollPendingTikTokPublishes } from '@/lib/social/tiktok-publish-poll-worker';
import { processTokenRefresh, cleanupExpiredOAuthStates } from '@/lib/oauth/token-refresh';
import { pollPendingVideoGenerations } from '@/lib/ai/video-poll-worker';
import { safeCompare } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { getAllDocs, getAllMatchingDocs } from '@/lib/firestore-pagination';
import { processQueuedPublicPublishRuns } from '@/lib/public-api/publish-runs';
import { processPendingWebhookDeliveries } from '@/lib/public-api/webhook-delivery';

export async function POST(req: Request) {
  try {
    const secret = process.env.WORKER_SECRET || '';
    const token = req.headers.get('x-worker-secret') || '';

    if (!secret || !safeCompare(token, secret)) {
      throw new Error('UNAUTHENTICATED');
    }

    const nowIso = new Date().toISOString();

    // 1. Refresh expiring OAuth tokens
    let tokenRefreshResult = { refreshed: 0, failed: 0, skipped: 0, errors: [] as Array<{ workspaceId: string; provider: string; error: string }> };
    try {
      tokenRefreshResult = await processTokenRefresh();
    } catch (e) {
      console.error('Token refresh failed:', e);
    }

    // 2. Clean up expired OAuth states
    let statesCleanedUp = 0;
    try {
      statesCleanedUp = await cleanupExpiredOAuthStates();
    } catch (e) {
      console.error('OAuth state cleanup failed:', e);
    }

    // 3. Poll pending video generations
    let videoPollResult = { polled: 0, completed: 0, failed: 0, errors: [] as Array<{ workspaceId: string; generationId: string; error: string }> };
    try {
      videoPollResult = await pollPendingVideoGenerations();
    } catch (e) {
      console.error('Video generation polling failed:', e);
    }

    // 4. Poll pending TikTok publishes
    let tiktokPublishPollResult = { polled: 0, completed: 0, failed: 0, pending: 0, errors: [] as Array<{ workspaceId: string; postId: string; error: string }> };
    try {
      tiktokPublishPollResult = await pollPendingTikTokPublishes();
    } catch (e) {
      console.error('TikTok publish polling failed:', e);
    }

    // 5. Process workspaces (paginated — no cap)
    const wsDocs = await getAllDocs('workspaces');

    let scanned = 0;
    const dueJobs: Array<{ workspaceId: string; jobId: string; data: Record<string, unknown> }> = [];

    // Track scheduled post processing results
    const postResults: Array<{
      workspaceId: string;
      claimed: number;
      processed: number;
      published: number;
      pending: number;
      retried: number;
      failed: number;
      recovered: number;
    }> = [];
    const postErrors: Array<{ workspaceId: string; postId?: string; error: string }> = [];
    const publicPublishResults: Array<{ workspaceId: string; runId: string; status: string }> = [];
    const webhookResults: Array<{ workspaceId: string; deliveryId: string; status: string }> = [];

    for (const ws of wsDocs) {
      const workspaceId = ws.id;

      // Recover stale publishes and process scheduled posts for this workspace.
      try {
        const staleRecovery = await recoverStalePublishingPosts(workspaceId);
        staleRecovery.errors.forEach((error) => {
          postErrors.push({ workspaceId, postId: error.postId, error: error.error });
        });

        const postResult = await processScheduledPosts(workspaceId);
        postResult.errors.forEach((error) => {
          postErrors.push({ workspaceId, postId: error.postId, error: error.error });
        });

        if (postResult.processed > 0 || staleRecovery.recovered > 0 || staleRecovery.failed > 0) {
          postResults.push({
            workspaceId,
            claimed: postResult.claimed,
            processed: postResult.processed,
            published: postResult.published,
            pending: postResult.pending,
            retried: postResult.retried,
            failed: postResult.failed + staleRecovery.failed,
            recovered: staleRecovery.recovered,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown scheduled post processing error';
        postErrors.push({ workspaceId, error: message });
      }

      try {
        const publishRunResults = await processQueuedPublicPublishRuns(workspaceId);
        publishRunResults.forEach((result) => {
          publicPublishResults.push({
            workspaceId,
            runId: result.runId,
            status: result.status,
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown public publish processing error';
        postErrors.push({ workspaceId, error: message });
      }

      try {
        const deliveries = await processPendingWebhookDeliveries(workspaceId);
        deliveries.forEach((delivery) => {
          webhookResults.push({
            workspaceId,
            deliveryId: delivery.deliveryId,
            status: delivery.status,
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown webhook delivery error';
        postErrors.push({ workspaceId, error: message });
      }

      // Process scheduled jobs (paginated)
      const jobsDocs = await getAllMatchingDocs(
        adminDb
          .collection(`workspaces/${workspaceId}/jobs`)
          .where('enabled', '==', true)
          .where('schedule', '==', 'daily'),
      );
      const jobsSnap = { size: jobsDocs.length, docs: jobsDocs };

      scanned += jobsSnap.size;

      for (const j of jobsSnap.docs) {
        const d = j.data();
        if (d.nextRunAt && String(d.nextRunAt) > nowIso) continue;
        dueJobs.push({ workspaceId, jobId: j.id, data: d });
      }
    }

    const results: Record<string, unknown>[] = [];
    for (const j of dueJobs) {
      const r = await executeJob(j.workspaceId, j.jobId, j.data as Parameters<typeof executeJob>[2]);
      results.push({ workspaceId: j.workspaceId, jobId: j.jobId, ...r });
    }

    return apiOk({
      ok: true,
      workspaces: wsDocs.length,
      scanned,
      due: dueJobs.length,
      processed: results.length,
      results,
      scheduledPosts: postResults,
      scheduledPostErrors: postErrors,
      tokenRefresh: {
        refreshed: tokenRefreshResult.refreshed,
        failed: tokenRefreshResult.failed,
        skipped: tokenRefreshResult.skipped,
        errors: tokenRefreshResult.errors,
      },
      oauthStatesCleanedUp: statesCleanedUp,
      videoGenerations: {
        polled: videoPollResult.polled,
        completed: videoPollResult.completed,
        failed: videoPollResult.failed,
        errors: videoPollResult.errors,
      },
      tiktokPublishes: {
        polled: tiktokPublishPollResult.polled,
        completed: tiktokPublishPollResult.completed,
        failed: tiktokPublishPollResult.failed,
        pending: tiktokPublishPollResult.pending,
        errors: tiktokPublishPollResult.errors,
      },
      publicPublishRuns: publicPublishResults,
      webhookDeliveries: webhookResults,
    });
  } catch (error) {
    return apiError(error);
  }
}
