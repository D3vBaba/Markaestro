import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { deleteExperimentAndData } from '@/lib/intelligence/experiment-lifecycle';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';
import { logger } from '@/lib/logger';

const assignmentSchema = z.object({
  armAPostIds: z.array(z.string().max(128)).max(1000).optional(),
  armBPostIds: z.array(z.string().max(128)).max(1000).optional(),
}).superRefine((value, ctx) => {
  const a = value.armAPostIds || [];
  const b = value.armBPostIds || [];
  const overlap = a.filter((id) => b.includes(id));
  if (overlap.length > 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'A post cannot be assigned to both experiment arms.',
      path: ['armBPostIds'],
    });
  }
});

async function loadLinkedPost(workspaceId: string, postId: string | undefined) {
  if (!postId) return null;
  const snap = await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    id: snap.id,
    content: typeof data.content === 'string' ? data.content : '',
    mediaUrls: Array.isArray(data.mediaUrls) ? data.mediaUrls.filter((u: unknown) => typeof u === 'string') : [],
    status: String(data.status || ''),
    scheduledAt: typeof data.scheduledAt === 'string' ? data.scheduledAt : null,
    publishedAt: typeof data.publishedAt === 'string' ? data.publishedAt : null,
    externalUrl: typeof data.externalUrl === 'string' ? data.externalUrl : null,
    externalId: typeof data.externalId === 'string' ? data.externalId : null,
    channel: typeof data.channel === 'string' ? data.channel : null,
    metricsByChannel: data.metricsByChannel || null,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(_req);
    requirePermission(ctx, 'intelligence.read');
    await requireIntelligenceAccess(ctx, 'advanced', 'intelligenceExperiments');
    const { id } = await params;
    const snap = await adminDb.doc(`workspaces/${ctx.workspaceId}/experiments/${id}`).get();
    if (!snap.exists) throw new Error('NOT_FOUND');
    const experiment = { id: snap.id, ...snap.data() } as {
      id: string;
      armAPostId?: string;
      armBPostId?: string;
      armAPostIds?: string[];
      armBPostIds?: string[];
      platform?: string;
    };
    const armAPostId = experiment.armAPostId || experiment.armAPostIds?.[0];
    const armBPostId = experiment.armBPostId || experiment.armBPostIds?.[0];
    const [armA, armB] = await Promise.all([
      loadLinkedPost(ctx.workspaceId, armAPostId),
      loadLinkedPost(ctx.workspaceId, armBPostId),
    ]);
    return apiOk({ experiment, posts: { a: armA, b: armB } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'experiments.manage');
    await requireIntelligenceAccess(ctx, 'advanced', 'intelligenceExperiments');
    const { id } = await params;
    const assignment = assignmentSchema.parse(await req.json());
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/experiments/${id}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error('NOT_FOUND');

    const armAPostIds = assignment.armAPostIds;
    const armBPostIds = assignment.armBPostIds;
    const assigned = (armAPostIds?.length || 0) + (armBPostIds?.length || 0);
    const currentStatus = String(snapshot.data()?.status || 'draft');
    const status = currentStatus === 'complete' || currentStatus === 'archived'
      ? currentStatus
      : assigned > 0 ? 'running' : 'draft';
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      status,
      updatedAt: now,
      updatedBy: ctx.uid,
    };
    if (armAPostIds) {
      payload.armAPostIds = armAPostIds;
      payload.armAPostId = armAPostIds[0] || null;
    }
    if (armBPostIds) {
      payload.armBPostIds = armBPostIds;
      payload.armBPostId = armBPostIds[0] || null;
    }
    await ref.set(payload, { merge: true });
    return apiOk({ experiment: { id, ...snapshot.data(), ...payload } });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'experiments.manage');
    await requireIntelligenceAccess(ctx, 'advanced', 'intelligenceExperiments');
    const { id } = await params;
    const result = await deleteExperimentAndData(ctx.workspaceId, id);
    logger.info('experiment deleted via API', {
      event: 'intelligence.experiments.delete_api',
      workspaceId: ctx.workspaceId,
      uid: ctx.uid,
      ...result,
    });
    return apiOk({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}
