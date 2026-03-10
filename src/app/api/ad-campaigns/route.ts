import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk, apiCreated } from '@/lib/api-response';
import { createAdCampaignSchema, paginationSchema } from '@/lib/schemas';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const { limit, status } = paginationSchema.parse({
      limit: url.searchParams.get('limit'),
      status: url.searchParams.get('status'),
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
