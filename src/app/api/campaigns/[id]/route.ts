import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { updateCampaignSchema } from '@/lib/schemas';
import {
  buildGenerationConfigSnapshot,
  classifyPipelineChange,
  hashObject,
} from '@/lib/campaign-runs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'campaigns')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');
    return apiOk({ id, ...snap.data() });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const body = await req.json();
    const data = updateCampaignSchema.parse(body);

    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'campaigns')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');
    const existing = snap.data()!;

    const patch: Record<string, unknown> = {
      ...data,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
    };

    if ((data.type || existing.type) === 'pipeline') {
      const previousSnapshot = buildGenerationConfigSnapshot({
        productId: existing.productId || undefined,
        pipeline: existing.pipeline || null,
      });
      const nextSnapshot = buildGenerationConfigSnapshot({
        productId: Object.prototype.hasOwnProperty.call(data, 'productId')
          ? data.productId || undefined
          : existing.productId || undefined,
        pipeline: data.pipeline ?? existing.pipeline ?? null,
      });

      const generativeChanged = hashObject(previousSnapshot) !== hashObject(nextSnapshot);
      if (generativeChanged) {
        patch.configVersion = Number(existing.configVersion || 1) + 1;
        patch.configDirty = true;
        patch.configDirtyReason = classifyPipelineChange(previousSnapshot, nextSnapshot);
      }
    }

    await ref.update(patch);
    return apiOk({ id, ...snap.data(), ...patch });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'campaigns')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    // Prevent deleting active campaigns
    const status = snap.data()?.status;
    if (status === 'active') {
      throw new Error('VALIDATION_CANNOT_DELETE_ACTIVE_CAMPAIGN');
    }

    await ref.delete();
    return apiOk({ ok: true, id });
  } catch (error) {
    return apiError(error);
  }
}
