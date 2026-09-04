import { adminDb } from '@/lib/firebase-admin';
import { getEffectiveLimits } from '@/lib/stripe/entitlements';
import type { SocialChannel } from '@/lib/schemas';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';
import { evaluateEvergreenEligibility } from './eligibility';
import { evergreenGenerationDueAt, nextEvergreenRunAt } from './scheduling';
import type { CreateEvergreenQueueInput, UpdateEvergreenQueueInput } from './schemas';
import type { EvergreenQueue, EvergreenVariant } from './types';
import { upcomingRunDates } from './cadence';
import { syncPostMediaReferences } from '@/lib/media/asset-store';
import { getSocialPostPreflightIssues } from '@/lib/social/post-preflight';
import { isManualReminderDeliveryMode } from '@/lib/manual-publish-flow';
import { enqueueWebhookEvent } from '@/lib/public-api/webhooks';
import { createInboxItem } from '@/lib/inbox';

const COLLECTION = 'evergreenQueues';

function queueCollection(workspaceId: string) {
  return adminDb.collection(`workspaces/${workspaceId}/${COLLECTION}`);
}

function queueRef(workspaceId: string, queueId: string) {
  return queueCollection(workspaceId).doc(queueId);
}

function auditRef(workspaceId: string) {
  return adminDb.collection(`workspaces/${workspaceId}/evergreenAudit`).doc();
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function queueFromDoc(doc: FirebaseFirestore.DocumentSnapshot): EvergreenQueue {
  return { id: doc.id, ...doc.data() } as EvergreenQueue;
}

export async function listEvergreenQueues(workspaceId: string, productId?: string) {
  let query: FirebaseFirestore.Query = queueCollection(workspaceId).orderBy('createdAt', 'desc');
  if (productId) query = queueCollection(workspaceId)
    .where('productId', '==', productId)
    .orderBy('createdAt', 'desc');
  const snap = await query.limit(100).get();
  return snap.docs.map(queueFromDoc).map((queue) => ({
    ...queue,
    upcomingRunAts: upcomingRunDates({
      nextRunAt: queue.nextRunAt,
      intervalDays: queue.intervalDays,
      timeZone: queue.timeZone,
      localHour: queue.localHour,
      localMinute: queue.localMinute,
    }),
  }));
}

export async function getEvergreenQueue(workspaceId: string, queueId: string) {
  const [queueSnap, variantsSnap] = await Promise.all([
    queueRef(workspaceId, queueId).get(),
    queueRef(workspaceId, queueId).collection('variants').orderBy('position', 'asc').get(),
  ]);
  if (!queueSnap.exists) throw new Error('NOT_FOUND');
  return {
    ...queueFromDoc(queueSnap),
    variants: variantsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as EvergreenVariant),
  };
}

export async function previewEvergreenQueue(
  workspaceId: string,
  sourcePostId: string,
  now = new Date(),
) {
  const snap = await adminDb.doc(`workspaces/${workspaceId}/posts/${sourcePostId}`).get();
  if (!snap.exists) throw new Error('NOT_FOUND');
  const post = snap.data() as Record<string, unknown>;
  const eligibility = evaluateEvergreenEligibility(post, now);
  const productId = typeof post.productId === 'string' ? post.productId : '';
  const cache = productId
    ? await adminDb.doc(`workspaces/${workspaceId}/products/${productId}/intelligence/insights`).get()
    : null;
  const cached = cache?.exists ? cache.data() as Record<string, unknown> : null;
  const insights = cached?.insights && typeof cached.insights === 'object'
    ? cached.insights as Record<string, unknown>
    : null;
  const timing = insights?.timing && typeof insights.timing === 'object'
    ? insights.timing as Record<string, unknown>
    : null;
  const windows = Array.isArray(timing?.windows) ? timing.windows as Array<Record<string, unknown>> : [];
  const best = windows.find((window) => typeof window.hour === 'string' || typeof window.hour === 'number');
  const learnedHour = best ? Number(best.hour) : NaN;
  const timeZone = typeof timing?.timeZone === 'string' && timing.timeZone ? timing.timeZone : 'UTC';
  const hasLearnedWindow = Boolean(timing?.accountSpecific) && Number.isInteger(learnedHour) && learnedHour >= 0 && learnedHour <= 23;
  return {
    sourcePostId,
    productId,
    eligibility,
    recommendation: {
      intervalDays: 30,
      timeZone,
      localHour: hasLearnedWindow ? learnedHour : 10,
      localMinute: 0,
      scheduleMode: hasLearnedWindow ? 'learned' : 'fixed',
      explanation: hasLearnedWindow
        ? `Use the strongest measured account window at ${String(learnedHour).padStart(2, '0')}:00 ${timeZone}, with a 30-day freshness gap.`
        : 'Start with a 30-day gap at 10:00 UTC and adjust after two mature occurrences.',
    },
  };
}

export async function createEvergreenQueue(
  workspaceId: string,
  actorId: string,
  input: CreateEvergreenQueueInput,
  options: { testMode?: boolean } = {},
) {
  const sourceRef = adminDb.doc(`workspaces/${workspaceId}/posts/${input.sourcePostId}`);
  const sourceSnap = await sourceRef.get();
  if (!sourceSnap.exists) throw new Error('NOT_FOUND');
  const source = sourceSnap.data() as Record<string, unknown>;
  if (source.productId !== input.productId) throw new Error('VALIDATION_EVERGREEN_SOURCE_BRAND_MISMATCH');

  const sourceChannels = evaluateEvergreenEligibility(source).channels;
  const channels = input.channels ?? sourceChannels;
  // A channel the source never went to is allowed when the caller names the
  // account to post to; activation still runs preflight on every channel.
  const extraDestinations = input.channelDestinations ?? {};
  if (channels.some((channel) => !sourceChannels.includes(channel) && !extraDestinations[channel])) {
    throw new Error('VALIDATION_EVERGREEN_CHANNEL_NOT_IN_SOURCE');
  }
  const mergedDestinations = { ...record(source.channelDestinations), ...extraDestinations };
  // X has a shorter product default; existing channels use the conservative
  // 30-day floor from the design.
  if (input.intervalDays < 30 && !channels.every((channel) => channel === 'x')) {
    throw new Error('VALIDATION_EVERGREEN_INTERVAL_TOO_SHORT');
  }

  const now = new Date().toISOString();
  const ref = queueCollection(workspaceId).doc();
  const queue: Omit<EvergreenQueue, 'id'> = {
    workspaceId,
    productId: input.productId,
    sourcePostId: input.sourcePostId,
    testMode: options.testMode === true,
    sourceSnapshot: {
      content: typeof source.content === 'string' ? source.content : '',
      mediaUrls: strings(source.mediaUrls),
      mediaAssetIds: strings(source.mediaAssetIds),
      settings: source.settings && typeof source.settings === 'object' ? source.settings as Record<string, unknown> : null,
      settingsByChannel: record(source.settingsByChannel),
      channelDestinations: mergedDestinations,
      channelDeliveryModes: record(source.channelDeliveryModes),
      destinationId: typeof source.destinationId === 'string' ? source.destinationId : '',
      destinationProvider: typeof source.destinationProvider === 'string' ? source.destinationProvider : '',
      capturedAt: now,
      sourcePublishedAt: typeof source.publishedAt === 'string' ? source.publishedAt : '',
    },
    name: input.name,
    status: 'draft',
    channels,
    intervalDays: input.intervalDays,
    timeZone: input.timeZone,
    localHour: input.localHour,
    localMinute: input.localMinute,
    scheduleMode: input.scheduleMode,
    cadenceMode: input.cadenceMode,
    cadenceHistory: [],
    reviewPolicy: input.reviewPolicy,
    expiresAt: input.expiresAt ?? null,
    nextRunAt: null,
    version: 1,
    runCount: 0,
    consecutiveUnderperformingRuns: 0,
    pauseReason: null,
    activationEvidence: null,
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
  };

  const batch = adminDb.batch();
  batch.create(ref, queue);
  input.variants.forEach((variant, position) => {
    const variantRef = ref.collection('variants').doc();
    batch.create(variantRef, {
      queueId: ref.id,
      caption: variant.caption,
      enabled: variant.enabled,
      position,
      createdAt: now,
      updatedAt: now,
    });
  });
  batch.create(auditRef(workspaceId), {
    queueId: ref.id,
    action: 'created',
    actorId,
    at: now,
  });
  await batch.commit();
  await syncPostMediaReferences(workspaceId, [], strings(source.mediaUrls));
  return getEvergreenQueue(workspaceId, ref.id);
}

export async function updateEvergreenQueue(
  workspaceId: string,
  queueId: string,
  actorId: string,
  input: UpdateEvergreenQueueInput,
) {
  const ref = queueRef(workspaceId, queueId);
  const now = new Date().toISOString();
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('NOT_FOUND');
    const current = snap.data() as EvergreenQueue;
    const { version, variants, ...changes } = input;
    if (current.version !== version) throw new Error('CONFLICT');
    if (current.status === 'archived') throw new Error('VALIDATION_EVERGREEN_ARCHIVED');
    const variantSnap = variants
      ? await tx.get(ref.collection('variants'))
      : null;
    tx.update(ref, { ...changes, version: current.version + 1, updatedAt: now });
    if (variants && variantSnap) {
      variantSnap.docs.forEach((doc) => tx.delete(doc.ref));
      variants.forEach((variant, position) => {
        tx.create(ref.collection('variants').doc(), {
          queueId,
          caption: variant.caption,
          enabled: variant.enabled,
          position,
          createdAt: now,
          updatedAt: now,
        });
      });
    }
    tx.create(auditRef(workspaceId), { queueId, action: 'updated', actorId, at: now });
  });
  return getEvergreenQueue(workspaceId, queueId);
}

async function getEvergreenCapacityLimit(workspaceId: string, actorId: string) {
  const limits = await getEffectiveLimits(actorId, workspaceId);
  const limit = limits.evergreenQueuesPerBrand;
  if (limit === 0) throw new Error('EVERGREEN_UPGRADE_REQUIRED');
  return limit;
}

async function assertEvergreenCapacityInTransaction(
  tx: FirebaseFirestore.Transaction,
  workspaceId: string,
  productId: string,
  limit: number,
  excludingQueueId?: string,
) {
  if (limit === -1) return;
  const snap = await tx.get(queueCollection(workspaceId)
    .where('productId', '==', productId)
    .where('status', '==', 'active')
    .limit(limit + 1));
  const count = snap.docs.filter((doc) => doc.id !== excludingQueueId).length;
  if (count >= limit) throw new Error('EVERGREEN_QUEUE_LIMIT_REACHED');
}

export async function activateEvergreenQueue(
  workspaceId: string,
  queueId: string,
  actorId: string,
) {
  const ref = queueRef(workspaceId, queueId);
  const initial = await ref.get();
  if (!initial.exists) throw new Error('NOT_FOUND');
  const current = initial.data() as EvergreenQueue;
  const capacityLimit = await getEvergreenCapacityLimit(workspaceId, actorId);
  const sourceSnap = await adminDb.doc(`workspaces/${workspaceId}/posts/${current.sourcePostId}`).get();
  if (!sourceSnap.exists) throw new Error('NOT_FOUND');
  const eligibility = evaluateEvergreenEligibility(sourceSnap.data() as Record<string, unknown>);
  if (!eligibility.eligible || !eligibility.evidence) {
    throw new Error('EVERGREEN_SOURCE_INELIGIBLE');
  }
  const source = sourceSnap.data() as Record<string, unknown>;
  const deliveryModes = record(source.channelDeliveryModes);
  const manualChannels = current.channels.filter((channel) =>
    isManualReminderDeliveryMode(deliveryModes[channel]));
  const preflight = await getSocialPostPreflightIssues(workspaceId, current.productId, {
    content: current.sourceSnapshot?.content ?? (typeof source.content === 'string' ? source.content : ''),
    channel: current.channels[0],
    targetChannels: current.channels,
    mediaUrls: current.sourceSnapshot?.mediaUrls ?? strings(source.mediaUrls),
  }, {
    requireReadyChannels: true,
    manualChannels,
    channelDestinations: record(source.channelDestinations) as Partial<Record<SocialChannel, string>>,
  });
  if (preflight.length > 0) throw new Error('EVERGREEN_SOURCE_INELIGIBLE');
  const firstRunAt = nextEvergreenRunAt({
    after: new Date(),
    intervalDays: current.intervalDays,
    timeZone: current.timeZone,
    localHour: current.localHour,
    localMinute: current.localMinute,
  });
  const now = new Date().toISOString();
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('NOT_FOUND');
    const fresh = snap.data() as EvergreenQueue;
    if (fresh.status === 'active') return;
    if (fresh.status === 'archived') throw new Error('VALIDATION_EVERGREEN_ARCHIVED');
    await assertEvergreenCapacityInTransaction(
      tx,
      workspaceId,
      fresh.productId,
      capacityLimit,
      queueId,
    );
    tx.update(ref, {
      status: 'active',
      nextRunAt: firstRunAt.toISOString(),
      activationEvidence: eligibility.evidence,
      pauseReason: null,
      version: fresh.version + 1,
      activatedAt: now,
      updatedAt: now,
    });
    tx.create(auditRef(workspaceId), { queueId, action: 'activated', actorId, at: now });
  });
  await markWorkspaceDue(workspaceId, evergreenGenerationDueAt(firstRunAt), 'evergreen_queue');
  await enqueueWebhookEvent(workspaceId, 'evergreen.queue.activated', {
    queueId,
    productId: current.productId,
    sourcePostId: current.sourcePostId,
    nextRunAt: firstRunAt.toISOString(),
  });
  return getEvergreenQueue(workspaceId, queueId);
}

export async function cancelScheduledEvergreenOccurrences(
  workspaceId: string,
  queueId: string,
  reason: string,
) {
  const snap = await adminDb.collection(`workspaces/${workspaceId}/posts`)
    .where('evergreen.queueId', '==', queueId)
    .where('status', '==', 'scheduled')
    .limit(400)
    .get();
  if (snap.empty) return;

  const now = new Date().toISOString();
  const batch = adminDb.batch();
  const cancelled: Array<{ postId: string; runId: string | null }> = [];
  for (const post of snap.docs) {
    const evergreen = record(post.get('evergreen'));
    const runId = typeof evergreen.runId === 'string' ? evergreen.runId : null;
    batch.update(post.ref, {
      status: 'draft',
      scheduledAt: null,
      updatedAt: now,
      'evergreen.cancelledAt': now,
      'evergreen.cancelReason': reason,
    });
    if (runId) {
      batch.set(queueRef(workspaceId, queueId).collection('runs').doc(runId), {
        status: 'skipped',
        reason,
        updatedAt: now,
      }, { merge: true });
    }
    cancelled.push({ postId: post.id, runId });
  }
  await batch.commit();
  await Promise.all(cancelled.map(({ postId, runId }) => enqueueWebhookEvent(
    workspaceId,
    'evergreen.run.skipped',
    { queueId, runId, postId, reason },
  )));
}

async function transitionQueue(
  workspaceId: string,
  queueId: string,
  actorId: string,
  action: 'paused' | 'resumed' | 'archived',
  capacityLimit?: number,
) {
  const ref = queueRef(workspaceId, queueId);
  const now = new Date();
  let nextRunAt: string | null = null;
  let archivedMediaUrls: string[] = [];
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('NOT_FOUND');
    const queue = snap.data() as EvergreenQueue;
    if (queue.status === 'archived' && action === 'archived') return;
    if (queue.status === 'archived' && action !== 'archived') throw new Error('VALIDATION_EVERGREEN_ARCHIVED');
    if (action === 'resumed') {
      if (capacityLimit === undefined) throw new Error('EVERGREEN_UPGRADE_REQUIRED');
      await assertEvergreenCapacityInTransaction(
        tx,
        workspaceId,
        queue.productId,
        capacityLimit,
        queueId,
      );
      nextRunAt = nextEvergreenRunAt({
        after: now,
        intervalDays: queue.intervalDays,
        timeZone: queue.timeZone,
        localHour: queue.localHour,
        localMinute: queue.localMinute,
      }).toISOString();
    }
    if (action === 'archived') archivedMediaUrls = queue.sourceSnapshot?.mediaUrls ?? [];
    tx.update(ref, {
      status: action === 'paused' ? 'paused' : action === 'resumed' ? 'active' : 'archived',
      nextRunAt,
      pauseReason: action === 'paused' ? 'USER_PAUSED' : null,
      version: queue.version + 1,
      updatedAt: now.toISOString(),
    });
    tx.create(auditRef(workspaceId), { queueId, action, actorId, at: now.toISOString() });
  });
  if (nextRunAt) {
    await markWorkspaceDue(workspaceId, evergreenGenerationDueAt(new Date(nextRunAt)), 'evergreen_queue');
  }
  if (action === 'paused' || action === 'archived') {
    await cancelScheduledEvergreenOccurrences(
      workspaceId,
      queueId,
      action === 'paused' ? 'USER_PAUSED' : 'QUEUE_ARCHIVED',
    );
  }
  if (archivedMediaUrls.length > 0) {
    await syncPostMediaReferences(workspaceId, archivedMediaUrls, []);
  }
  if (action === 'paused') {
    await enqueueWebhookEvent(workspaceId, 'evergreen.queue.paused', {
      queueId,
      reason: 'USER_PAUSED',
    });
  }
  return getEvergreenQueue(workspaceId, queueId);
}

export const pauseEvergreenQueue = (workspaceId: string, queueId: string, actorId: string) =>
  transitionQueue(workspaceId, queueId, actorId, 'paused');
export const resumeEvergreenQueue = async (workspaceId: string, queueId: string, actorId: string) => {
  const capacityLimit = await getEvergreenCapacityLimit(workspaceId, actorId);
  return transitionQueue(workspaceId, queueId, actorId, 'resumed', capacityLimit);
};
export const archiveEvergreenQueue = (workspaceId: string, queueId: string, actorId: string) =>
  transitionQueue(workspaceId, queueId, actorId, 'archived');

export async function pauseEvergreenQueueForSystem(
  workspaceId: string,
  queueId: string,
  reason: string,
) {
  const ref = queueRef(workspaceId, queueId);
  const now = new Date().toISOString();
  let paused = false;
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const queue = snap.data() as EvergreenQueue;
    if (queue.status === 'archived') return;
    if (queue.status === 'paused' && queue.pauseReason === reason) return;
    tx.update(ref, {
      status: 'paused',
      pauseReason: reason,
      nextRunAt: null,
      version: queue.version + 1,
      updatedAt: now,
    });
    tx.create(auditRef(workspaceId), {
      queueId,
      action: 'paused',
      actorId: 'system',
      reason,
      at: now,
    });
    paused = true;
  });
  if (!paused) return;
  await cancelScheduledEvergreenOccurrences(workspaceId, queueId, reason);
  await enqueueWebhookEvent(workspaceId, 'evergreen.queue.paused', { queueId, reason });
  const queue = await ref.get();
  const uid = typeof queue.data()?.createdBy === 'string' ? queue.data()?.createdBy as string : '';
  if (uid) {
    await createInboxItem({
      id: `evergreen_pause_${queueId}_${reason}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200),
      workspaceId,
      uid,
      type: 'system',
      title: 'Evergreen queue paused',
      body: `Markaestro paused this queue: ${reason}. Review it before resuming.`,
      href: '/content?tab=evergreen',
      meta: { queueId, reason },
    });
  }
}

/**
 * Apply a reduced per-brand plan limit without deleting queue history. The
 * oldest active queues remain active; newer excess queues are paused in a
 * stable createdAt/id order so repeated webhook deliveries reach the same
 * result.
 */
export async function reconcileEvergreenPlanLimit(
  workspaceId: string,
  limit: number,
) {
  if (limit === -1) return { pausedQueueIds: [] as string[] };
  const snap = await queueCollection(workspaceId).where('status', '==', 'active').get();
  const byProduct = new Map<string, EvergreenQueue[]>();
  for (const doc of snap.docs) {
    const queue = queueFromDoc(doc);
    const rows = byProduct.get(queue.productId) ?? [];
    rows.push(queue);
    byProduct.set(queue.productId, rows);
  }
  const pausedQueueIds: string[] = [];
  for (const queues of byProduct.values()) {
    queues.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const queue of queues.slice(Math.max(0, limit))) {
      await pauseEvergreenQueueForSystem(workspaceId, queue.id, 'PLAN_LIMIT_REDUCED');
      pausedQueueIds.push(queue.id);
    }
  }
  return { pausedQueueIds };
}

export async function listEvergreenRuns(workspaceId: string, queueId: string) {
  const queue = await queueRef(workspaceId, queueId).get();
  if (!queue.exists) throw new Error('NOT_FOUND');
  const snap = await queueRef(workspaceId, queueId).collection('runs')
    .orderBy('plannedAt', 'desc')
    .limit(100)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}


// ─── Review inbox ────────────────────────────────────────────────────────────

export type EvergreenReviewRow = {
  queueId: string;
  queueName: string;
  runId: string;
  plannedAt: string;
  postId: string;
  content: string;
  channel: string;
  channels: string[];
  thumbnailUrl: string | null;
  mediaUrl: string | null;
};

/** Every occurrence waiting on a person, across a brand's queues. */
export async function listEvergreenReviews(workspaceId: string, productId: string): Promise<EvergreenReviewRow[]> {
  const queues = await queueCollection(workspaceId).where('productId', '==', productId).limit(100).get();
  const rows: EvergreenReviewRow[] = [];
  for (const queue of queues.docs) {
    if (queue.data().status === 'archived') continue;
    const runs = await queue.ref.collection('runs').where('status', '==', 'needs_review').limit(50).get();
    if (runs.empty) continue;
    const postIds = runs.docs.map((run) => String(run.get('occurrencePostId') ?? '')).filter(Boolean);
    const posts = postIds.length > 0
      ? await adminDb.getAll(...postIds.map((id) => adminDb.doc(`workspaces/${workspaceId}/posts/${id}`)))
      : [];
    const byId = new Map(posts.filter((snap) => snap.exists).map((snap) => [snap.id, snap.data() as Record<string, unknown>]));
    for (const run of runs.docs) {
      const postId = String(run.get('occurrencePostId') ?? '');
      const post = byId.get(postId);
      if (!post) continue;
      const media = strings(post.mediaUrls);
      rows.push({
        queueId: queue.id,
        queueName: String(queue.data().name ?? ''),
        runId: run.id,
        plannedAt: String(run.get('plannedAt') ?? ''),
        postId,
        content: typeof post.content === 'string' ? post.content : '',
        channel: typeof post.channel === 'string' ? post.channel : '',
        channels: strings(post.targetChannels),
        thumbnailUrl: typeof post.thumbnailUrl === 'string' ? post.thumbnailUrl : media.find((url) => !/\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) ?? null,
        mediaUrl: media[0] ?? null,
      });
    }
  }
  return rows.sort((a, b) => a.plannedAt.localeCompare(b.plannedAt));
}

/** Approve a reviewed occurrence: it goes back on the calendar at its planned slot, or fifteen minutes from now if that slot has passed. */
export async function approveEvergreenRun(workspaceId: string, queueId: string, runId: string, actorId: string) {
  const runRef = queueRef(workspaceId, queueId).collection('runs').doc(runId);
  const runSnap = await runRef.get();
  if (!runSnap.exists) throw new Error('NOT_FOUND');
  if (runSnap.get('status') !== 'needs_review') throw new Error('VALIDATION_EVERGREEN_RUN_NOT_REVIEWABLE');
  const postId = String(runSnap.get('occurrencePostId') ?? '');
  const postRef = adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`);
  const postSnap = await postRef.get();
  if (!postSnap.exists) throw new Error('NOT_FOUND');
  const now = new Date();
  const planned = Date.parse(String(runSnap.get('plannedAt') ?? ''));
  const scheduledAt = new Date(Number.isFinite(planned) && planned > now.getTime() ? planned : now.getTime() + 15 * 60 * 1000).toISOString();
  const batch = adminDb.batch();
  batch.update(postRef, { status: 'scheduled', scheduledAt, updatedAt: now.toISOString() });
  batch.update(runRef, { status: 'scheduled', plannedAt: scheduledAt, reviewedBy: actorId, reviewedAt: now.toISOString(), updatedAt: now.toISOString() });
  batch.create(auditRef(workspaceId), { queueId, runId, action: 'run_approved', actorId, at: now.toISOString() });
  await batch.commit();
  await markWorkspaceDue(workspaceId, scheduledAt, 'scheduled_post');
  return { runId, postId, scheduledAt };
}

/** Skip a reviewed occurrence: the draft is removed and the run recorded as skipped. */
export async function skipEvergreenRun(workspaceId: string, queueId: string, runId: string, actorId: string) {
  const runRef = queueRef(workspaceId, queueId).collection('runs').doc(runId);
  const runSnap = await runRef.get();
  if (!runSnap.exists) throw new Error('NOT_FOUND');
  if (runSnap.get('status') !== 'needs_review') throw new Error('VALIDATION_EVERGREEN_RUN_NOT_REVIEWABLE');
  const postId = String(runSnap.get('occurrencePostId') ?? '');
  const postRef = adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`);
  const postSnap = await postRef.get();
  const now = new Date().toISOString();
  const batch = adminDb.batch();
  if (postSnap.exists) batch.delete(postRef);
  batch.update(runRef, { status: 'skipped', reason: 'SKIPPED_IN_REVIEW', reviewedBy: actorId, reviewedAt: now, updatedAt: now });
  batch.create(auditRef(workspaceId), { queueId, runId, action: 'run_skipped', actorId, at: now });
  await batch.commit();
  if (postSnap.exists) await syncPostMediaReferences(workspaceId, strings(postSnap.data()?.mediaUrls), []);
  return { runId, postId };
}
