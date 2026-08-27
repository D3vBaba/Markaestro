import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';
import { closeExperimentIfDue, resolveExperimentArmValues } from '@/lib/intelligence/experiment-lifecycle';
import { evaluateExperiment } from '@/lib/intelligence/statistics';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'experiments.manage');
    await requireIntelligenceAccess(ctx, 'advanced', 'intelligenceExperiments');
    const { id } = await params;
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/experiments/${id}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error('NOT_FOUND');
    const experiment = { id, ...(snapshot.data() || {}) } as {
      id: string;
      endsAt?: string;
      status?: string;
      targetSamplePerArm?: number;
      armAPostId?: string;
      armBPostId?: string;
      armAPostIds?: string[];
      armBPostIds?: string[];
      platform?: string;
      metric?: string;
      notifiedAt?: string | null;
      createdBy?: string;
      name?: string;
      productId?: string;
    };

    // If the window has ended, use the lifecycle closer (also sends inbox).
    if (experiment.endsAt && Date.parse(experiment.endsAt) <= Date.now()) {
      const closed = await closeExperimentIfDue(ctx.workspaceId, id);
      const refreshed = await ref.get();
      return apiOk({ id, result: refreshed.data()?.result || null, closed: closed.closed });
    }

    const values = await resolveExperimentArmValues(ctx.workspaceId, experiment);
    if (!values) throw new Error('VALIDATION_EXPERIMENT_OBSERVATIONS');
    const result = evaluateExperiment({
      armA: values.armA,
      armB: values.armB,
      targetSamplePerArm: Math.max(1, Number(experiment.targetSamplePerArm) || 1),
    });
    const now = new Date().toISOString();
    const status = result.status === 'inconclusive'
      ? (experiment.status === 'draft' ? 'running' : experiment.status || 'running')
      : 'complete';
    await ref.set({
      result: {
        ...result,
        armACount: values.armA.length,
        armBCount: values.armB.length,
        armAValue: values.armA[0] ?? null,
        armBValue: values.armB[0] ?? null,
      },
      status,
      evaluatedAt: now,
      updatedAt: now,
      evaluatedBy: ctx.uid,
    }, { merge: true });
    return apiOk({ id, result });
  } catch (error) {
    return apiError(error);
  }
}
