import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { paginationSchema } from '@/lib/schemas';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const url = new URL(req.url);
    const { limit } = paginationSchema.parse({
      limit: url.searchParams.get('limit') ?? 20,
    });

    const snap = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/job_runs`)
      .where('jobId', '==', id)
      .orderBy('startedAt', 'desc')
      .limit(limit)
      .get();

    const runs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return apiOk({ runs, count: runs.length });
  } catch (error) {
    return apiError(error);
  }
}
