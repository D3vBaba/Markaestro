import { apiCreated, apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { createPairedExperimentSchema } from '@/lib/intelligence/management-schemas';
import {
  computeExperimentWindow,
  newExperimentId,
  scheduleExperimentClose,
} from '@/lib/intelligence/experiment-lifecycle';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';
import { logger } from '@/lib/logger';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'intelligence.read');
    await requireIntelligenceAccess(ctx, 'advanced', 'intelligenceExperiments');
    const snapshot = await adminDb.collection(`workspaces/${ctx.workspaceId}/experiments`).limit(200).get();
    return apiOk({ experiments: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'experiments.manage');
    await requireIntelligenceAccess(ctx, 'advanced', 'intelligenceExperiments');
    if (!ctx.emailVerified) {
      return apiOk({ error: 'EMAIL_NOT_VERIFIED', message: 'Verify your email to schedule experiment posts.' }, 403);
    }

    const input = createPairedExperimentSchema.parse(await req.json());
    if (!(await adminDb.doc(`workspaces/${ctx.workspaceId}/products/${input.productId}`).get()).exists) {
      throw new Error('NOT_FOUND');
    }

    const id = newExperimentId();
    const now = new Date().toISOString();
    const { startsAt, endsAt } = computeExperimentWindow({
      armAScheduledAt: input.armA.scheduledAt,
      armBScheduledAt: input.armB.scheduledAt,
      durationDays: input.durationDays,
    });

    const postsCol = adminDb.collection(`workspaces/${ctx.workspaceId}/posts`);
    const armARef = postsCol.doc();
    const armBRef = postsCol.doc();

    const basePost = {
      channel: input.platform,
      targetChannels: [input.platform],
      status: 'scheduled' as const,
      productId: input.productId,
      workspaceId: ctx.workspaceId,
      createdBy: ctx.uid,
      createdAt: now,
      updatedAt: now,
      experimentId: id,
    };

    const armAPost = {
      ...basePost,
      content: input.armA.content,
      mediaUrls: input.armA.mediaUrls,
      scheduledAt: input.armA.scheduledAt,
      experimentArm: 'a',
    };
    const armBPost = {
      ...basePost,
      content: input.armB.content,
      mediaUrls: input.armB.mediaUrls,
      scheduledAt: input.armB.scheduledAt,
      experimentArm: 'b',
    };

    const experiment = {
      id,
      workspaceId: ctx.workspaceId,
      productId: input.productId,
      name: input.name,
      hypothesis: input.hypothesis,
      platform: input.platform,
      metric: input.metric,
      durationDays: input.durationDays,
      targetSamplePerArm: input.targetSamplePerArm,
      status: Date.parse(startsAt) <= Date.now() ? 'running' : 'scheduled',
      startsAt,
      endsAt,
      arms: [
        { id: 'a', label: input.armA.label || 'A', postId: armARef.id },
        { id: 'b', label: input.armB.label || 'B', postId: armBRef.id },
      ],
      armAPostId: armARef.id,
      armBPostId: armBRef.id,
      armAPostIds: [armARef.id],
      armBPostIds: [armBRef.id],
      result: null,
      notifiedAt: null,
      createdBy: ctx.uid,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 2,
    };

    const batch = adminDb.batch();
    batch.set(armARef, { id: armARef.id, ...armAPost });
    batch.set(armBRef, { id: armBRef.id, ...armBPost });
    batch.set(adminDb.doc(`workspaces/${ctx.workspaceId}/experiments/${id}`), experiment);
    await batch.commit();

    await Promise.all([
      markWorkspaceDue(ctx.workspaceId, input.armA.scheduledAt, 'scheduled_post').catch((error) => {
        logger.warn('experiment arm A due marker failed', { event: 'worker.mark_due_failed', err: error });
      }),
      markWorkspaceDue(ctx.workspaceId, input.armB.scheduledAt, 'scheduled_post').catch((error) => {
        logger.warn('experiment arm B due marker failed', { event: 'worker.mark_due_failed', err: error });
      }),
      scheduleExperimentClose(ctx.workspaceId, endsAt),
    ]);

    return apiCreated({
      experiment,
      posts: [
        { id: armARef.id, ...armAPost },
        { id: armBRef.id, ...armBPost },
      ],
    });
  } catch (error) {
    return apiError(error);
  }
}
