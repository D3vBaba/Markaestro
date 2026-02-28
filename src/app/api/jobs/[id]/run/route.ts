import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { executeJob } from '@/lib/jobs/executor';
import { apiError, apiOk } from '@/lib/api-response';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/jobs/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const job = snap.data() as any;
    if (!job.enabled) throw new Error('VALIDATION_JOB_DISABLED');

    const result = await executeJob(ctx.workspaceId, id, job);
    return apiOk({ jobId: id, ...result });
  } catch (error) {
    return apiError(error);
  }
}
