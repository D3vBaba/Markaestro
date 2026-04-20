import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk, apiCreated } from '@/lib/api-response';
import { createCampaignSchema, paginationSchema } from '@/lib/schemas';
import { executeListQuery } from '@/lib/firestore-list-query';

export const runtime = 'nodejs';


export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const { limit, status } = paginationSchema.parse({
      limit: url.searchParams.get('limit') ?? 50,
      status: url.searchParams.get('status') ?? undefined,
    });

    const campaigns = await executeListQuery(
      adminDb.collection(workspaceCollection(ctx.workspaceId, 'campaigns')),
      {
        filters: status ? [{ field: 'status', op: '==', value: status }] : [],
        orderByField: 'createdAt',
        limit,
      },
    );
    return apiOk({ workspaceId: ctx.workspaceId, campaigns, count: campaigns.length });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'campaigns.write');
    const body = await req.json();
    const data = createCampaignSchema.parse(body);
    const now = new Date().toISOString();

    const payload = {
      ...data,
      workspaceId: ctx.workspaceId,
      createdBy: ctx.uid,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await adminDb
      .collection(workspaceCollection(ctx.workspaceId, 'campaigns'))
      .add(payload);

    return apiCreated({ id: ref.id, ...payload });
  } catch (error) {
    return apiError(error);
  }
}
