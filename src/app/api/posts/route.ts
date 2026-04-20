import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk, apiCreated } from '@/lib/api-response';
import { createPostSchema, paginationSchema } from '@/lib/schemas';
import { executeListQuery, type FieldFilter } from '@/lib/firestore-list-query';

export const runtime = 'nodejs';


export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const { limit, status } = paginationSchema.parse({
      limit: url.searchParams.get('limit') ?? 50,
      status: url.searchParams.get('status') ?? undefined,
    });
    const channel = url.searchParams.get('channel') ?? undefined;

    const filters: FieldFilter[] = [];
    if (status) {
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
      filters.push(statuses.length === 1
        ? { field: 'status', op: '==', value: statuses[0] }
        : { field: 'status', op: 'in', value: statuses });
    }
    if (channel) filters.push({ field: 'channel', op: '==', value: channel });

    const posts = await executeListQuery(
      adminDb.collection(`workspaces/${ctx.workspaceId}/posts`),
      { filters, orderByField: 'createdAt', limit },
    );
    return apiOk({ workspaceId: ctx.workspaceId, posts, count: posts.length });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    const body = await req.json();
    const data = createPostSchema.parse(body);
    const now = new Date().toISOString();

    const payload = {
      ...data,
      workspaceId: ctx.workspaceId,
      createdBy: ctx.uid,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/posts`)
      .add(payload);

    return apiCreated({ id: ref.id, ...payload });
  } catch (error) {
    return apiError(error);
  }
}
