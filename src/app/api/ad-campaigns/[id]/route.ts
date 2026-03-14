import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { updateAdCampaignSchema } from '@/lib/schemas';
import { isMetaObjectiveSupported } from '@/lib/ads/meta-ads';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/ad_campaigns/${id}`);
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
    const input = updateAdCampaignSchema.parse(body);

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/ad_campaigns/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const existing = snap.data() as { platform?: string; productId?: string };
    const nextPlatform = input.platform ?? existing.platform;
    const nextProductId = Object.prototype.hasOwnProperty.call(input, 'productId')
      ? input.productId
      : existing.productId;

    if (nextPlatform === 'meta' && !nextProductId) {
      throw new Error('VALIDATION_META_PRODUCT_REQUIRED');
    }
    if (nextPlatform === 'meta' && input.objective && !isMetaObjectiveSupported(input.objective)) {
      throw new Error('VALIDATION_META_OBJECTIVE_UNSUPPORTED');
    }

    const update = {
      ...input,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
    };

    await ref.update(update);
    return apiOk({ id, ...update });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    const { id } = await params;

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/ad_campaigns/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    await ref.delete();
    return apiOk({ ok: true, deleted: id });
  } catch (error) {
    return apiError(error);
  }
}
