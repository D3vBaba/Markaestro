import { adminDb } from '@/lib/firebase-admin';
import type { NormalizedPostMetrics } from '@/lib/platform/types';
import type { EvergreenQueue } from './types';
import { enqueueWebhookEvent } from '@/lib/public-api/webhooks';
import { pauseEvergreenQueueForSystem } from './storage';
import { adaptInterval, cadenceFloorDays, nextVariantState, UNDERPERFORMANCE_INDEX } from './cadence';
import { evergreenGenerationDueAt, nextEvergreenRunAt } from './scheduling';
import type { EvergreenVariant } from './types';
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
      const healthy = performanceIndex >= UNDERPERFORMANCE_INDEX;
      const nextUnderperforming = healthy ? 0 : consecutiveUnderperformingRuns + 1;
      consecutiveUnderperformingRuns = nextUnderperforming;
      const shouldPause = nextUnderperforming >= 2 && queue.status === 'active';
      const batch = adminDb.batch();

      // Per-caption retirement: a caption that misses twice in a row is
      // switched off while other captions remain, so one stale angle does
      // not drag the whole queue into a pause.
      const variantId = typeof run.variantId === 'string' ? run.variantId : '';
      let retiredVariant = false;
      if (variantId) {
        const variantsSnap = await queueDoc.ref.collection('variants').where('enabled', '==', true).get();
        const variantRef = queueDoc.ref.collection('variants').doc(variantId);
        const variantSnap = variantsSnap.docs.find((doc) => doc.id === variantId) ?? await variantRef.get();
        const variant = variantSnap.exists ? (variantSnap.data() as Partial<EvergreenVariant>) : null;
        if (variant) {
          const next = nextVariantState({
            consecutiveUnderperformingRuns: variant.consecutiveUnderperformingRuns ?? 0,
            healthy,
            enabledVariants: variantsSnap.size,
          });
          retiredVariant = next.retire;
          batch.update(variantRef, {
            consecutiveUnderperformingRuns: next.consecutiveUnderperformingRuns,
            ...(next.retire ? { enabled: false, retiredReason: 'UNDERPERFORMED', retiredAt: now.toISOString() } : {}),
            updatedAt: now.toISOString(),
          });
        }
      }

      // Adaptive cadence: move the interval and, when the next occurrence has
      // not been generated yet, the next run date with it.
      const cadenceUpdate: Record<string, unknown> = {};
      if ((queue.cadenceMode ?? 'fixed') === 'adaptive') {
        const nextInterval = adaptInterval({ intervalDays: queue.intervalDays, healthy, floorDays: cadenceFloorDays(queue.channels) });
        if (nextInterval !== queue.intervalDays) {
          cadenceUpdate.intervalDays = nextInterval;
          cadenceUpdate.cadenceHistory = [...(queue.cadenceHistory ?? []).slice(-19), {
            at: now.toISOString(), from: queue.intervalDays, to: nextInterval, reason: healthy ? 'HEALTHY' : 'UNDERPERFORMED',
          }];
          const plannedAt = typeof run.plannedAt === 'string' ? new Date(run.plannedAt) : null;
          if (plannedAt && queue.status === 'active' && queue.nextRunAt) {
            const candidate = nextEvergreenRunAt({ after: plannedAt, intervalDays: nextInterval, timeZone: queue.timeZone, localHour: queue.localHour, localMinute: queue.localMinute });
            const leadMs = 48 * 60 * 60 * 1000;
            if (candidate.getTime() > now.getTime() + leadMs && candidate.toISOString() !== queue.nextRunAt) {
              cadenceUpdate.nextRunAt = candidate.toISOString();
              await markWorkspaceDue(workspaceId, evergreenGenerationDueAt(candidate), 'evergreen_queue');
            }
          }
          queue.intervalDays = nextInterval;
        }
      }
      batch.update(runDoc.ref, {
        status: 'evaluated',
        performanceIndex,
        reason: healthy ? 'HEALTHY' : 'UNDERPERFORMED',
        retiredVariant,
        evaluatedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      batch.update(queueDoc.ref, {
        consecutiveUnderperformingRuns: nextUnderperforming,
        ...cadenceUpdate,
        updatedAt: now.toISOString(),
      });
      await batch.commit();
      if (shouldPause) {
        await pauseEvergreenQueueForSystem(workspaceId, queue.id, 'PERFORMANCE_DECAY');
      }
      if (!healthy) {
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
