import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk, apiCreated } from '@/lib/api-response';
import { createPostSchema, paginationSchema } from '@/lib/schemas';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const { limit, status } = paginationSchema.parse({
      limit: url.searchParams.get('limit') ?? 50,
      status: url.searchParams.get('status') ?? undefined,
    });
    const channel = url.searchParams.get('channel') ?? undefined;

    let query = adminDb
      .collection(`workspaces/${ctx.workspaceId}/posts`)
      .orderBy('createdAt', 'desc');

    if (status) {
      query = query.where('status', '==', status);
    }
    if (channel) {
      query = query.where('channel', '==', channel);
    }

    const snapshot = await query.limit(limit).get();
    const posts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return apiOk({ workspaceId: ctx.workspaceId, posts, count: posts.length });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
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
