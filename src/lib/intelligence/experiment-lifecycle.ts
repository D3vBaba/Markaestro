import { randomUUID } from 'node:crypto';
import type { DocumentReference, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { evaluateExperiment } from '@/lib/intelligence/statistics';
import { measuredNumber, engagementTotal } from '@/lib/intelligence/overview-metrics';
import type { SocialChannel } from '@/lib/schemas';
import { logger } from '@/lib/logger';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';
import { createInboxItem } from '@/lib/inbox';

type ExperimentDoc = {
  id: string;
  productId?: string;
  name?: string;
  platform?: string;
  metric?: string;
  status?: string;
  endsAt?: string;
  startsAt?: string;
  targetSamplePerArm?: number;
  armAPostId?: string;
  armBPostId?: string;
  armAPostIds?: string[];
  armBPostIds?: string[];
  notifiedAt?: string | null;
  createdBy?: string;
};

type PostMetricsSource = {
  metricsByChannel?: Partial<Record<SocialChannel, Record<string, number | null>>>;
  latestMetrics?: Record<string, number | null> | null;
};

function metricFromPost(post: PostMetricsSource, platform: string | undefined, metric: string | undefined): number | null {
  const channelMetrics = platform
    ? post.metricsByChannel?.[platform as SocialChannel]
    : undefined;
  const metrics = channelMetrics || post.latestMetrics || {};
  if (metric === 'clicks') return measuredNumber(metrics.clicks);
  if (metric === 'engagements') {
    return engagementTotal({
      likes: measuredNumber(metrics.likes) ?? undefined,
      comments: measuredNumber(metrics.comments) ?? undefined,
      shares: measuredNumber(metrics.shares) ?? undefined,
      saves: measuredNumber(metrics.saves) ?? undefined,
    });
  }
  return measuredNumber(metrics.views) ?? measuredNumber(metrics.reach);
}

async function loadPost(workspaceId: string, postId: string | undefined) {
  if (!postId) return null;
  const snap = await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Record<string, unknown>) };
}

async function socialMetricValues(
  workspaceId: string,
  markaestroPostId: string,
  platform: string | undefined,
  metric: string | undefined,
): Promise<number[]> {
  const social = await adminDb.collection(`workspaces/${workspaceId}/socialPosts`)
    .where('markaestroPostId', '==', markaestroPostId)
    .limit(5)
    .get();
  const values: number[] = [];
  for (const doc of social.docs) {
    const data = doc.data() as PostMetricsSource & { platform?: string };
    const value = metricFromPost(
      { latestMetrics: (data.latestMetrics || null) as Record<string, number | null> | null },
      platform || data.platform,
      metric,
    );
    if (value !== null) values.push(value);
  }
  return values;
}

export async function resolveExperimentArmValues(
  workspaceId: string,
  experiment: ExperimentDoc,
): Promise<{ armA: number[]; armB: number[]; armAPostId?: string; armBPostId?: string } | null> {
  const armAPostId = experiment.armAPostId || experiment.armAPostIds?.[0];
  const armBPostId = experiment.armBPostId || experiment.armBPostIds?.[0];
  const [postA, postB] = await Promise.all([
    loadPost(workspaceId, armAPostId),
    loadPost(workspaceId, armBPostId),
  ]);
  if (!postA || !postB) return null;

  let armA = await socialMetricValues(workspaceId, postA.id, experiment.platform, experiment.metric);
  let armB = await socialMetricValues(workspaceId, postB.id, experiment.platform, experiment.metric);

  if (!armA.length) {
    const value = metricFromPost(postA as PostMetricsSource, experiment.platform, experiment.metric);
    if (value !== null) armA = [value];
  }
  if (!armB.length) {
    const value = metricFromPost(postB as PostMetricsSource, experiment.platform, experiment.metric);
    if (value !== null) armB = [value];
  }

  if (!armA.length || !armB.length) return null;
  return { armA, armB, armAPostId: postA.id, armBPostId: postB.id };
}

export async function closeExperimentIfDue(
  workspaceId: string,
  experimentId: string,
  now = new Date(),
): Promise<{ closed: boolean; status?: string }> {
  const ref = adminDb.doc(`workspaces/${workspaceId}/experiments/${experimentId}`);
  const snap = await ref.get();
  if (!snap.exists) return { closed: false };
  const experiment = { ...(snap.data() as ExperimentDoc), id: snap.id };
  if (experiment.status === 'complete' || experiment.status === 'archived') return { closed: false };
  if (!experiment.endsAt || Date.parse(experiment.endsAt) > now.getTime()) return { closed: false };

  const values = await resolveExperimentArmValues(workspaceId, experiment);
  const nowIso = now.toISOString();
  if (!values) {
    await ref.set({
      status: 'complete',
      result: {
        status: 'inconclusive',
        effectPercent: null,
        confidenceInterval: null,
        reason: 'missing_metrics',
      },
      evaluatedAt: nowIso,
      updatedAt: nowIso,
    }, { merge: true });
    await notifyExperimentComplete(workspaceId, experiment, 'inconclusive');
    return { closed: true, status: 'inconclusive' };
  }

  const result = evaluateExperiment({
    armA: values.armA,
    armB: values.armB,
    targetSamplePerArm: Math.max(1, Number(experiment.targetSamplePerArm) || 1),
  });
  await ref.set({
    status: 'complete',
    result: {
      ...result,
      armACount: values.armA.length,
      armBCount: values.armB.length,
      armAValue: values.armA[0] ?? null,
      armBValue: values.armB[0] ?? null,
    },
    evaluatedAt: nowIso,
    updatedAt: nowIso,
  }, { merge: true });
  await notifyExperimentComplete(workspaceId, experiment, result.status);
  return { closed: true, status: result.status };
}

async function notifyExperimentComplete(
  workspaceId: string,
  experiment: ExperimentDoc,
  resultStatus: string,
) {
  if (experiment.notifiedAt) return;
  const winnerLabel = resultStatus === 'winner_a'
    ? 'Arm A'
    : resultStatus === 'winner_b'
      ? 'Arm B'
      : null;
  const title = winnerLabel
    ? `Experiment result: ${winnerLabel} won`
    : 'Experiment ended: inconclusive';
  const body = winnerLabel
    ? `"${experiment.name || 'Experiment'}" finished. ${winnerLabel} performed better on ${experiment.platform || 'the platform'}.`
    : `"${experiment.name || 'Experiment'}" finished without a clear winner. Review the measured metrics in Intelligence.`;
  await createInboxItem({
    workspaceId,
    uid: experiment.createdBy || 'system',
    type: 'experiment_complete',
    title,
    body,
    href: `/intelligence?tab=advanced&experiment=${experiment.id}`,
    meta: {
      experimentId: experiment.id,
      productId: experiment.productId || null,
      resultStatus,
    },
  });
  await adminDb.doc(`workspaces/${workspaceId}/experiments/${experiment.id}`).set({
    notifiedAt: new Date().toISOString(),
  }, { merge: true });
}

export async function processDueExperiments(workspaceId: string, now = new Date()): Promise<{
  scanned: number;
  closed: number;
}> {
  const nowIso = now.toISOString();
  let docs: QueryDocumentSnapshot[] = [];
  try {
    const snapshot = await adminDb.collection(`workspaces/${workspaceId}/experiments`)
      .where('status', 'in', ['scheduled', 'running'])
      .where('endsAt', '<=', nowIso)
      .limit(25)
      .get();
    docs = snapshot.docs;
  } catch (error) {
    logger.warn('experiment due query failed; using status scan', {
      event: 'intelligence.experiments.due_query_failed',
      workspaceId,
      err: error,
    });
    const snapshot = await adminDb.collection(`workspaces/${workspaceId}/experiments`)
      .where('status', 'in', ['scheduled', 'running'])
      .limit(50)
      .get();
    docs = snapshot.docs.filter((doc) => {
      const endsAt = doc.data()?.endsAt;
      return typeof endsAt === 'string' && Date.parse(endsAt) <= now.getTime();
    });
  }

  let closed = 0;
  for (const doc of docs) {
    const outcome = await closeExperimentIfDue(workspaceId, doc.id, now);
    if (outcome.closed) closed += 1;
  }

  const starting = await adminDb.collection(`workspaces/${workspaceId}/experiments`)
    .where('status', '==', 'scheduled')
    .limit(25)
    .get();
  for (const doc of starting.docs) {
    const startsAt = doc.data()?.startsAt;
    if (typeof startsAt === 'string' && Date.parse(startsAt) <= now.getTime()) {
      await doc.ref.set({ status: 'running', updatedAt: nowIso }, { merge: true });
    }
  }

  return { scanned: docs.length, closed };
}

export async function scheduleExperimentClose(workspaceId: string, endsAt: string) {
  await markWorkspaceDue(workspaceId, endsAt, 'experiment_close').catch(() => undefined);
}

function collectArmPostIds(experiment: ExperimentDoc): string[] {
  const ids = new Set<string>();
  for (const value of [
    experiment.armAPostId,
    experiment.armBPostId,
    ...(experiment.armAPostIds || []),
    ...(experiment.armBPostIds || []),
  ]) {
    if (typeof value === 'string' && value.trim()) ids.add(value);
  }
  return [...ids];
}

async function deleteDocsInBatches(refs: DocumentReference[]) {
  for (let offset = 0; offset < refs.length; offset += 400) {
    const batch = adminDb.batch();
    for (const ref of refs.slice(offset, offset + 400)) batch.delete(ref);
    await batch.commit();
  }
}

/** Removes the experiment document, linked arm posts, matching socialPosts, and related inbox items. */
export async function deleteExperimentAndData(workspaceId: string, experimentId: string): Promise<{
  experimentId: string;
  deletedPostIds: string[];
  deletedSocialPostIds: string[];
  deletedInboxIds: string[];
}> {
  const experimentRef = adminDb.doc(`workspaces/${workspaceId}/experiments/${experimentId}`);
  const snap = await experimentRef.get();
  if (!snap.exists) throw new Error('NOT_FOUND');
  const experiment = { ...(snap.data() as ExperimentDoc), id: snap.id };

  const postIds = new Set(collectArmPostIds(experiment));
  try {
    const linked = await adminDb.collection(`workspaces/${workspaceId}/posts`)
      .where('experimentId', '==', experimentId)
      .limit(50)
      .get();
    for (const doc of linked.docs) postIds.add(doc.id);
  } catch (error) {
    logger.warn('experiment post lookup by experimentId failed', {
      event: 'intelligence.experiments.delete_posts_query_failed',
      workspaceId,
      experimentId,
      err: error,
    });
  }

  const deletedSocialPostIds: string[] = [];
  const refsToDelete: DocumentReference[] = [];
  for (const postId of postIds) {
    refsToDelete.push(adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`));
    try {
      const social = await adminDb.collection(`workspaces/${workspaceId}/socialPosts`)
        .where('markaestroPostId', '==', postId)
        .limit(20)
        .get();
      for (const doc of social.docs) {
        deletedSocialPostIds.push(doc.id);
        refsToDelete.push(doc.ref);
      }
    } catch (error) {
      logger.warn('experiment socialPosts cleanup query failed', {
        event: 'intelligence.experiments.delete_social_query_failed',
        workspaceId,
        experimentId,
        postId,
        err: error,
      });
    }
  }

  const deletedInboxIds: string[] = [];
  try {
    const inbox = await adminDb.collection(`workspaces/${workspaceId}/inbox`)
      .where('type', '==', 'experiment_complete')
      .limit(100)
      .get();
    for (const doc of inbox.docs) {
      const data = doc.data() || {};
      const meta = (data.meta && typeof data.meta === 'object') ? data.meta as Record<string, unknown> : {};
      if (data.experimentId === experimentId || meta.experimentId === experimentId) {
        deletedInboxIds.push(doc.id);
        refsToDelete.push(doc.ref);
      }
    }
  } catch (error) {
    logger.warn('experiment inbox cleanup query failed', {
      event: 'intelligence.experiments.delete_inbox_query_failed',
      workspaceId,
      experimentId,
      err: error,
    });
  }

  refsToDelete.push(experimentRef);
  await deleteDocsInBatches(refsToDelete);

  logger.info('experiment deleted with linked data', {
    event: 'intelligence.experiments.deleted',
    workspaceId,
    experimentId,
    deletedPosts: postIds.size,
    deletedSocialPosts: deletedSocialPostIds.length,
    deletedInbox: deletedInboxIds.length,
  });

  return {
    experimentId,
    deletedPostIds: [...postIds],
    deletedSocialPostIds,
    deletedInboxIds,
  };
}

export function computeExperimentWindow(input: {
  armAScheduledAt: string;
  armBScheduledAt: string;
  durationDays: number;
}) {
  const startMs = Math.max(Date.parse(input.armAScheduledAt), Date.parse(input.armBScheduledAt));
  const startsAt = new Date(startMs).toISOString();
  const endsAt = new Date(startMs + input.durationDays * 24 * 60 * 60 * 1000).toISOString();
  return { startsAt, endsAt };
}

export function newExperimentId() {
  return randomUUID();
}
