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

    // Build query — equality filters (.where) + .orderBy on a different field require a
    // composite Firestore index. To avoid that deployment dependency, we apply equality
    // filters without orderBy and sort the results in JS afterwards.
    let ref = adminDb.collection(`workspaces/${ctx.workspaceId}/posts`) as FirebaseFirestore.Query;

    if (status) {
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
      ref = statuses.length === 1
        ? ref.where('status', '==', statuses[0])
        : ref.where('status', 'in', statuses);
    }
    if (channel) ref = ref.where('channel', '==', channel);

    // Only use orderBy when there are no equality filters (single-field index is enough)
    if (!status && !channel) ref = ref.orderBy('createdAt', 'desc');

    const snapshot = await ref.limit(limit).get();
    const posts = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, unknown> & { createdAt?: string }))
      .sort((a, b) => ((b.createdAt ?? '') > (a.createdAt ?? '') ? 1 : -1));
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
