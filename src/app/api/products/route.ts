import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk, apiCreated } from '@/lib/api-response';
import { createProductSchema, paginationSchema } from '@/lib/schemas';
import { executeListQueryPage } from '@/lib/firestore-list-query';
import { getEffectiveLimits } from '@/lib/stripe/entitlements';

export const runtime = 'nodejs';


export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'dashboard.read');
    const url = new URL(req.url);
    const { limit, status, cursor } = paginationSchema.parse({
      limit: url.searchParams.get('limit') ?? 50,
      status: url.searchParams.get('status') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
    });

    const page = await executeListQueryPage(
      adminDb.collection(workspaceCollection(ctx.workspaceId, 'products')),
      {
        filters: status ? [{ field: 'status', op: '==', value: status }] : [],
        orderByField: 'createdAt',
        limit,
        cursor,
      },
    );
    return apiOk({
      workspaceId: ctx.workspaceId,
      products: page.items,
      count: page.items.length,
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'products.write');

    // A product IS a brand: enforce the plan's brand cap (base plan plus any
    // purchased brand-pack add-ons) before creating another one.
    const limits = await getEffectiveLimits(ctx.uid, ctx.workspaceId);
    if (limits.brands !== -1) {
      const countSnap = await adminDb
        .collection(workspaceCollection(ctx.workspaceId, 'products'))
        .count()
        .get();
      if (countSnap.data().count >= limits.brands) {
        return apiError(new Error('BRAND_LIMIT_REACHED'));
      }
    }

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
