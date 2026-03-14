import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk, apiCreated } from '@/lib/api-response';
import { createAdCampaignSchema, paginationSchema } from '@/lib/schemas';
import { isMetaObjectiveSupported } from '@/lib/ads/meta-ads';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const { limit, status } = paginationSchema.parse({
      limit: url.searchParams.get('limit') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
    });

    let query = adminDb
      .collection(`workspaces/${ctx.workspaceId}/ad_campaigns`)
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (status) {
      query = query.where('status', '==', status);
    }

    const snap = await query.get();
    const campaigns = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return apiOk({ campaigns });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const input = createAdCampaignSchema.parse(body);

    if (input.platform === 'meta' && !input.productId) {
      throw new Error('VALIDATION_META_PRODUCT_REQUIRED');
    }
    if (input.platform === 'meta' && !isMetaObjectiveSupported(input.objective)) {
      throw new Error('VALIDATION_META_OBJECTIVE_UNSUPPORTED');
    }

    const now = new Date().toISOString();
    const doc = {
      ...input,
      workspaceId: ctx.workspaceId,
      status: 'draft' as const,
      createdAt: now,
      updatedAt: now,
      createdBy: ctx.uid,
    };

    const ref = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/ad_campaigns`)
      .add(doc);

    return apiCreated({ id: ref.id, ...doc });
  } catch (error) {
    return apiError(error);
  }
}
