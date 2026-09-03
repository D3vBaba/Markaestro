import { adminDb } from '@/lib/firebase-admin';
import type { NormalizedPostMetrics } from '@/lib/platform/types';
import type { EvergreenQueue } from './types';
import { enqueueWebhookEvent } from '@/lib/public-api/webhooks';
import { pauseEvergreenQueueForSystem } from './storage';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';

function engagement(metrics: unknown): number | null {
  if (!metrics || typeof metrics !== 'object') return null;
  const values = Object.values(metrics as Record<string, NormalizedPostMetrics>);
  let total = 0;
  let measured = false;
  for (const row of values) {
    if (!row || typeof row !== 'object') continue;
    for (const key of ['likes', 'comments', 'shares', 'saves', 'clicks'] as const) {
      const value = row[key];
      if (typeof value === 'number') {
        total += value;
        measured = true;
      }
    }
  }
  return measured ? total : null;
}

export async function processEvergreenEvaluations(workspaceId: string) {
  const queuesSnap = await adminDb.collection(`workspaces/${workspaceId}/evergreenQueues`)
    .where('status', 'in', ['active', 'paused'])
    .limit(50)
    .get();
  const results: Array<{ queueId: string; runId: string; status: string }> = [];
  const now = new Date();

  for (const queueDoc of queuesSnap.docs) {
    const queue = { id: queueDoc.id, ...queueDoc.data() } as EvergreenQueue;
    let consecutiveUnderperformingRuns = queue.consecutiveUnderperformingRuns;
    const runs = await queueDoc.ref.collection('runs')
      .where('status', 'in', ['needs_review', 'scheduled', 'published'])
      .where('evaluationDueAt', '<=', now.toISOString())
      .orderBy('evaluationDueAt', 'asc')
      .limit(10)
      .get();
    for (const runDoc of runs.docs) {
      const run = runDoc.data();
      const occurrenceId = typeof run.occurrencePostId === 'string' ? run.occurrencePostId : '';
      const [sourceSnap, occurrenceSnap] = await Promise.all([
        adminDb.doc(`workspaces/${workspaceId}/posts/${queue.sourcePostId}`).get(),
        adminDb.doc(`workspaces/${workspaceId}/posts/${occurrenceId}`).get(),
      ]);
      if (!sourceSnap.exists || !occurrenceSnap.exists) {
        await runDoc.ref.update({ status: 'failed', reason: 'POST_RECORD_MISSING', updatedAt: now.toISOString() });
        results.push({ queueId: queue.id, runId: runDoc.id, status: 'failed' });
        continue;
      }
      const occurrence = occurrenceSnap.data() as Record<string, unknown>;
      if (occurrence.status !== 'published') {
        const retryAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
        await runDoc.ref.update({
          evaluationDueAt: retryAt,
          reason: 'WAITING_FOR_PUBLICATION',
          updatedAt: now.toISOString(),
        });
        await markWorkspaceDue(workspaceId, retryAt, 'evergreen_evaluation');
        continue;
      }
      const sourceValue = engagement(sourceSnap.data()?.metricsByChannel);
      const occurrenceValue = engagement(occurrence.metricsByChannel);
      if (sourceValue == null || occurrenceValue == null || sourceValue <= 0) {
        const retryAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
        await runDoc.ref.update({
          evaluationDueAt: retryAt,
          reason: 'METRICS_UNAVAILABLE',
          updatedAt: now.toISOString(),
        });
        await markWorkspaceDue(workspaceId, retryAt, 'evergreen_evaluation');
        continue;
      }
      const performanceIndex = occurrenceValue / sourceValue;
      const nextUnderperforming = performanceIndex < 0.6
        ? consecutiveUnderperformingRuns + 1
        : 0;
      consecutiveUnderperformingRuns = nextUnderperforming;
      const shouldPause = nextUnderperforming >= 2 && queue.status === 'active';
      const batch = adminDb.batch();
      batch.update(runDoc.ref, {
        status: 'evaluated',
        performanceIndex,
        reason: performanceIndex < 0.6 ? 'UNDERPERFORMED' : 'HEALTHY',
        evaluatedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      batch.update(queueDoc.ref, {
        consecutiveUnderperformingRuns: nextUnderperforming,
        updatedAt: now.toISOString(),
      });
      await batch.commit();
      if (shouldPause) {
        await pauseEvergreenQueueForSystem(workspaceId, queue.id, 'PERFORMANCE_DECAY');
      }
      if (performanceIndex < 0.6) {
        await enqueueWebhookEvent(workspaceId, 'evergreen.run.underperformed', {
          queueId: queue.id,
          runId: runDoc.id,
          postId: occurrenceId,
          performanceIndex,
          queuePaused: shouldPause,
        });
      }
      results.push({ queueId: queue.id, runId: runDoc.id, status: shouldPause ? 'paused' : 'evaluated' });
    }
  }
  return results;
}
