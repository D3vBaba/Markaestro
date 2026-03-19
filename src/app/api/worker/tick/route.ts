import { adminDb } from '@/lib/firebase-admin';
import { executeJob } from '@/lib/jobs/executor';
import { processScheduledPosts } from '@/lib/social/publisher';
import { processTokenRefresh, cleanupExpiredOAuthStates } from '@/lib/oauth/token-refresh';
import { pollPendingVideoGenerations } from '@/lib/ai/video-poll-worker';
import { safeCompare } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';

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

    // 4. Process workspaces
    const wsSnap = await adminDb.collection('workspaces').limit(200).get();

    let scanned = 0;
    const dueJobs: Array<{ workspaceId: string; jobId: string; data: Record<string, unknown> }> = [];

    // Track scheduled post processing results
    const postResults: Array<{ workspaceId: string; processed: number }> = [];

    for (const ws of wsSnap.docs) {
      const workspaceId = ws.id;

      // Process scheduled posts for this workspace
      const postResult = await processScheduledPosts(workspaceId);
      if (postResult.processed > 0) {
        postResults.push({ workspaceId, processed: postResult.processed });
      }

      // Process scheduled jobs
      const jobsSnap = await adminDb
        .collection(`workspaces/${workspaceId}/jobs`)
        .where('enabled', '==', true)
        .where('schedule', '==', 'daily')
        .limit(200)
        .get();

      scanned += jobsSnap.size;

      for (const j of jobsSnap.docs) {
        const d = j.data();
        if (d.nextRunAt && String(d.nextRunAt) > nowIso) continue;
        dueJobs.push({ workspaceId, jobId: j.id, data: d });
      }
    }

    const results: Record<string, unknown>[] = [];
    for (const j of dueJobs) {
      const r = await executeJob(j.workspaceId, j.jobId, j.data as any);
      results.push({ workspaceId: j.workspaceId, jobId: j.jobId, ...r });
    }

    return apiOk({
      ok: true,
      workspaces: wsSnap.size,
      scanned,
      due: dueJobs.length,
      processed: results.length,
      results,
      scheduledPosts: postResults,
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
    });
  } catch (error) {
    return apiError(error);
  }
}
