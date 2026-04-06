import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk, apiCreated } from '@/lib/api-response';
import { createProductSchema, paginationSchema } from '@/lib/schemas';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const { limit, status } = paginationSchema.parse({
      limit: url.searchParams.get('limit') ?? 50,
      status: url.searchParams.get('status') ?? undefined,
    });

    let query = adminDb
      .collection(workspaceCollection(ctx.workspaceId, 'products')) as FirebaseFirestore.Query;

    if (status) {
      query = query.where('status', '==', status);
    } else {
      query = query.orderBy('createdAt', 'desc');
    }

    const snapshot = await query.limit(limit).get();
    const products = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, unknown> & { createdAt?: string }))
      .sort((a, b) => ((b.createdAt ?? '') > (a.createdAt ?? '') ? 1 : -1));
    return apiOk({ workspaceId: ctx.workspaceId, products, count: products.length });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'products.write');
    const body = await req.json();
    const data = createProductSchema.parse(body);
    const now = new Date().toISOString();

    const payload = {
      ...data,
      workspaceId: ctx.workspaceId,
      createdBy: ctx.uid,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await adminDb
      .collection(workspaceCollection(ctx.workspaceId, 'products'))
      .add(payload);

    return apiCreated({ id: ref.id, ...payload });
  } catch (error) {
    return apiError(error);
  }
}
