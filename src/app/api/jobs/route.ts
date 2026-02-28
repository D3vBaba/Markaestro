import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk, apiCreated } from '@/lib/api-response';
import { createJobSchema, paginationSchema } from '@/lib/schemas';
import { computeNextRun } from '@/lib/jobs/executor';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const { limit } = paginationSchema.parse({
      limit: url.searchParams.get('limit') ?? 100,
    });

    const snap = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/jobs`)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const jobs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return apiOk({ workspaceId: ctx.workspaceId, jobs, count: jobs.length });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const data = createJobSchema.parse(body);
    const now = new Date().toISOString();

    const payload = {
      ...data,
      workspaceId: ctx.workspaceId,
      createdBy: ctx.uid,
      nextRunAt: computeNextRun(data.schedule, data.hourUTC, data.minuteUTC),
      createdAt: now,
      updatedAt: now,
    };

    const ref = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/jobs`)
      .add(payload);

    return apiCreated({ id: ref.id, ...payload });
  } catch (error) {
    return apiError(error);
  }
}
