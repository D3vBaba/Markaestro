import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk, apiCreated } from '@/lib/api-response';
import { createAutomationSchema, paginationSchema } from '@/lib/schemas';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const { limit } = paginationSchema.parse({
      limit: url.searchParams.get('limit') ?? 50,
    });

    const snapshot = await adminDb
      .collection(workspaceCollection(ctx.workspaceId, 'automations'))
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const automations = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return apiOk({ workspaceId: ctx.workspaceId, automations, count: automations.length });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const data = createAutomationSchema.parse(body);
    const now = new Date().toISOString();

    const payload = {
      ...data,
      workspaceId: ctx.workspaceId,
      createdBy: ctx.uid,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await adminDb
      .collection(workspaceCollection(ctx.workspaceId, 'automations'))
      .add(payload);

    return apiCreated({ id: ref.id, ...payload });
  } catch (error) {
    return apiError(error);
  }
}
