import { adminDb } from '@/lib/firebase-admin';
import { syncPostMediaReferences } from '@/lib/media/asset-store';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';
import { evergreenGenerationDueAt, deterministicRunId, nextEvergreenRunAt } from './scheduling';
import type { EvergreenQueue, EvergreenVariant } from './types';
import { getSocialPostPreflightIssues } from '@/lib/social/post-preflight';
import { MANUAL_REMINDER_DELIVERY_MODE, isManualReminderDeliveryMode } from '@/lib/manual-publish-flow';
import { enqueueWebhookEvent } from '@/lib/public-api/webhooks';
import type { SocialChannel } from '@/lib/schemas';
import { pauseEvergreenQueueForSystem } from './storage';
import { createInboxItem } from '@/lib/inbox';
import { busyDaysFor, findCollisionFreeDate } from './collisions';

const GENERATION_LEAD_MS = 48 * 60 * 60 * 1000;
const MAX_QUEUES_PER_TICK = 20;

type GenerationResult = {
  queueId: string;
  runId?: string;
  postId?: string;
  status: 'generated' | 'skipped' | 'duplicate' | 'paused';
  reason?: string;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

async function enabledVariants(workspaceId: string, queueId: string): Promise<EvergreenVariant[]> {
  const snap = await adminDb.collection(`workspaces/${workspaceId}/evergreenQueues/${queueId}/variants`)
    .where('enabled', '==', true)
    .orderBy('position', 'asc')
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as EvergreenVariant);
}

async function generateOccurrence(
  workspaceId: string,
  queueId: string,
): Promise<GenerationResult> {
  const queueRef = adminDb.doc(`workspaces/${workspaceId}/evergreenQueues/${queueId}`);
  const initial = await queueRef.get();
  if (!initial.exists) return { queueId, status: 'skipped', reason: 'QUEUE_NOT_FOUND' };
  const queue = { id: initial.id, ...initial.data() } as EvergreenQueue;
  if (queue.status !== 'active' || !queue.nextRunAt) return { queueId, status: 'skipped', reason: 'QUEUE_NOT_ACTIVE' };
  if (queue.expiresAt && Date.parse(queue.expiresAt) <= Date.now()) {
    await pauseEvergreenQueueForSystem(workspaceId, queueId, 'QUEUE_EXPIRED');
    return { queueId, status: 'paused', reason: 'QUEUE_EXPIRED' };
  }

  if (!queue.contentReview) {
    await pauseEvergreenQueueForSystem(workspaceId, queueId, 'EVERGREEN_CONTENT_REVIEW_REQUIRED');
    return { queueId, status: 'paused', reason: 'EVERGREEN_CONTENT_REVIEW_REQUIRED' };
  }
  const sourceBeforeRun = await adminDb.doc(`workspaces/${workspaceId}/posts/${queue.sourcePostId}`).get();
  if (!sourceBeforeRun.exists) {
    await pauseEvergreenQueueForSystem(workspaceId, queueId, 'EVERGREEN_SOURCE_MISSING');
    return { queueId, status: 'paused', reason: 'EVERGREEN_SOURCE_MISSING' };
  }
  const sourceData = sourceBeforeRun.data() as Record<string, unknown>;
  const modes: Record<string, unknown> = { ...queue.sourceSnapshot?.channelDeliveryModes, ...(queue.channels.includes('x') ? { x: MANUAL_REMINDER_DELIVERY_MODE } : {}) };
  const manualChannels = queue.channels.filter((channel) =>
    isManualReminderDeliveryMode(modes[channel]));
  const preflight = await getSocialPostPreflightIssues(workspaceId, queue.productId, {
    content: queue.sourceSnapshot?.content ?? String(sourceData.content ?? ''),
    channel: queue.channels[0],
    targetChannels: queue.channels,
    mediaUrls: queue.sourceSnapshot?.mediaUrls ?? asStringArray(sourceData.mediaUrls),
  }, {
    requireReadyChannels: true,
    manualChannels,
    channelDestinations: (queue.sourceSnapshot?.channelDestinations ?? {}) as Partial<Record<SocialChannel, string>>,
  });
  if (preflight.length > 0) {
    const reason = preflight[0].code;
    await pauseEvergreenQueueForSystem(workspaceId, queueId, reason);
    return { queueId, status: 'paused', reason };
  }

  const variants = await enabledVariants(workspaceId, queueId);
  if (variants.length === 0) {
    await pauseEvergreenQueueForSystem(workspaceId, queueId, 'NO_ENABLED_VARIANTS');
    return { queueId, status: 'paused', reason: 'NO_ENABLED_VARIANTS' };
  }
  // Do not land on a day that already has a fresh post for this brand and
  // channel: move the run forward (at most three days) and let the next tick
  // pick it up at the new date.
  const planned = new Date(queue.nextRunAt);
  const windowStart = new Date(planned.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(planned.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const scheduledSnap = await adminDb.collection(`workspaces/${workspaceId}/posts`)
    .where('status', '==', 'scheduled')
    .where('scheduledAt', '>=', windowStart)
    .where('scheduledAt', '<', windowEnd)
    .orderBy('scheduledAt', 'asc')
    .limit(200)
    .get();
  const busy = busyDaysFor({
    posts: scheduledSnap.docs.map((doc) => doc.data()),
    productId: queue.productId,
    channels: queue.channels,
    queueId,
    timeZone: queue.timeZone,
  });
  const free = findCollisionFreeDate({ planned, busyDays: busy, timeZone: queue.timeZone });
  if (free.shiftedDays > 0) {
    const shiftedAt = free.date.toISOString();
    await queueRef.update({
      nextRunAt: shiftedAt,
      lastCollisionShift: { from: queue.nextRunAt, to: shiftedAt, days: free.shiftedDays, at: new Date().toISOString() },
      version: queue.version + 1,
      updatedAt: new Date().toISOString(),
    });
    await markWorkspaceDue(workspaceId, evergreenGenerationDueAt(free.date), 'evergreen_queue');
    return { queueId, status: 'skipped', reason: 'COLLISION_SHIFTED' };
  }

  const variant = variants[queue.runCount % variants.length];
  const runId = deterministicRunId(queueId, queue.nextRunAt);
  const runRef = queueRef.collection('runs').doc(runId);
  const postRef = adminDb.collection(`workspaces/${workspaceId}/posts`).doc(`evergreen_${runId}`);
  const sourceRef = adminDb.doc(`workspaces/${workspaceId}/posts/${queue.sourcePostId}`);
  const now = new Date().toISOString();
  let mediaUrls: string[] = [];
  let created = false;
  let nextRunAt: Date | null = null;

  await adminDb.runTransaction(async (tx) => {
    const [freshQueueSnap, existingRun, sourceSnap] = await Promise.all([
      tx.get(queueRef),
      tx.get(runRef),
      tx.get(sourceRef),
    ]);
    if (existingRun.exists) return;
    if (!freshQueueSnap.exists || !sourceSnap.exists) throw new Error('EVERGREEN_SOURCE_MISSING');
    const freshQueue = { id: freshQueueSnap.id, ...freshQueueSnap.data() } as EvergreenQueue;
    if (freshQueue.status !== 'active' || freshQueue.nextRunAt !== queue.nextRunAt) return;
    if (!freshQueue.nextRunAt || !freshQueue.contentReview || freshQueue.version !== queue.version) return;
    const source = sourceSnap.data() as Record<string, unknown>;
    if (source.status !== 'published') throw new Error('EVERGREEN_SOURCE_NOT_PUBLISHED');

    const sourceSnapshot = freshQueue.sourceSnapshot;
    mediaUrls = sourceSnapshot?.mediaUrls ?? asStringArray(source.mediaUrls);
    const targetChannels = freshQueue.channels;
    const primaryChannel = targetChannels[0];
    const status = freshQueue.reviewPolicy === 'review_each_run' ? 'draft' : 'scheduled';
    const runStatus = status === 'draft' ? 'needs_review' : 'scheduled';
    const plannedAt = freshQueue.nextRunAt;
    nextRunAt = nextEvergreenRunAt({
      after: new Date(plannedAt),
      intervalDays: freshQueue.intervalDays,
      timeZone: freshQueue.timeZone,
      localHour: freshQueue.localHour,
      localMinute: freshQueue.localMinute,
    });
    const sourceSettings = sourceSnapshot?.settingsByChannel ?? (
      source.settingsByChannel && typeof source.settingsByChannel === 'object' ? source.settingsByChannel : {}
    );
    const sourceDestinations = sourceSnapshot?.channelDestinations ?? (
      source.channelDestinations && typeof source.channelDestinations === 'object' ? source.channelDestinations : {}
    );
    const sourceDeliveryModes = sourceSnapshot?.channelDeliveryModes ?? (
      source.channelDeliveryModes && typeof source.channelDeliveryModes === 'object' ? source.channelDeliveryModes : {}
    );

    tx.create(postRef, {
      content: variant.caption,
      channel: primaryChannel,
      targetChannels,
      channelDestinations: sourceDestinations,
      channelDeliveryModes: { ...sourceDeliveryModes, ...(targetChannels.includes('x') ? { x: MANUAL_REMINDER_DELIVERY_MODE } : {}) },
      settingsByChannel: sourceSettings,
      settings: (sourceSettings as Record<string, unknown>)[primaryChannel] ?? sourceSnapshot?.settings ?? source.settings ?? null,
      status,
      scheduledAt: status === 'scheduled' ? plannedAt : null,
      originalScheduledAt: plannedAt,
      mediaUrls,
      mediaAssetIds: sourceSnapshot?.mediaAssetIds ?? asStringArray(source.mediaAssetIds),
      productId: freshQueue.productId,
      destinationId: sourceSnapshot?.destinationId ?? (typeof source.destinationId === 'string' ? source.destinationId : ''),
      destinationProvider: sourceSnapshot?.destinationProvider ?? (typeof source.destinationProvider === 'string' ? source.destinationProvider : ''),
      workspaceId,
      createdBy: freshQueue.createdBy,
      testMode: freshQueue.testMode === true,
      sourceType: 'evergreen',
      evergreen: {
        queueId,
        runId,
        sourcePostId: freshQueue.sourcePostId,
        variantId: variant.id,
      },
      createdAt: now,
      updatedAt: now,
      externalId: '',
      externalUrl: '',
      errorMessage: '',
      publishResults: [],
    });
    tx.create(runRef, {
      workspaceId,
      queueId,
      sourcePostId: freshQueue.sourcePostId,
      occurrencePostId: postRef.id,
      variantId: variant.id,
      plannedAt,
      status: runStatus,
      evaluationDueAt: null,
      performanceIndex: null,
      reason: null,
      createdAt: now,
      updatedAt: now,
    });
    tx.update(queueRef, {
      nextRunAt: nextRunAt.toISOString(),
      runCount: freshQueue.runCount + 1,
      lastGeneratedAt: now,
      version: freshQueue.version + 1,
      updatedAt: now,
    });
    created = true;
  });

  if (!created) return { queueId, runId, status: 'duplicate' };
  await syncPostMediaReferences(workspaceId, [], mediaUrls);
  if (queue.reviewPolicy !== 'review_each_run') {
    await markWorkspaceDue(workspaceId, queue.nextRunAt, 'scheduled_post');
  }
  if (nextRunAt) {
    await markWorkspaceDue(workspaceId, evergreenGenerationDueAt(nextRunAt), 'evergreen_queue');
  }
  await enqueueWebhookEvent(
    workspaceId,
    queue.reviewPolicy === 'review_each_run' ? 'evergreen.queue.needs_review' : 'evergreen.run.scheduled',
    {
      queueId,
      runId,
      postId: postRef.id,
      plannedAt: queue.nextRunAt,
    },
  );
  if (queue.reviewPolicy === 'review_each_run') {
    await createInboxItem({
      id: `evergreen_review_${runId}`,
      workspaceId,
      uid: queue.createdBy,
      type: 'system',
      title: 'Evergreen post ready for review',
      body: 'A new occurrence is waiting in Drafts. Review and schedule it when ready.',
      href: '/content?tab=drafts',
      meta: { queueId, runId, postId: postRef.id },
    });
  }
  return { queueId, runId, postId: postRef.id, status: 'generated' };
}

export async function processDueEvergreenQueues(workspaceId: string): Promise<GenerationResult[]> {
  const cutoff = new Date(Date.now() + GENERATION_LEAD_MS).toISOString();
  const snap = await adminDb.collection(`workspaces/${workspaceId}/evergreenQueues`)
    .where('status', '==', 'active')
    .where('nextRunAt', '<=', cutoff)
    .orderBy('nextRunAt', 'asc')
    .limit(MAX_QUEUES_PER_TICK)
    .get();
  const results: GenerationResult[] = [];
  for (const doc of snap.docs) {
    try {
      const result = await generateOccurrence(workspaceId, doc.id);
      results.push(result);
      if (result.status === 'paused') {
        await enqueueWebhookEvent(workspaceId, 'evergreen.run.skipped', {
          queueId: doc.id,
          reason: result.reason ?? 'QUEUE_PAUSED',
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'UNKNOWN';
      if (reason.startsWith('EVERGREEN_SOURCE_')) {
        await pauseEvergreenQueueForSystem(workspaceId, doc.id, reason);
      }
      results.push({ queueId: doc.id, status: 'paused', reason });
      await enqueueWebhookEvent(workspaceId, 'evergreen.run.skipped', {
        queueId: doc.id,
        reason,
      });
    }
  }
  return results;
}
