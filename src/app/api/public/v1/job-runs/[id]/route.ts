import { adminDb } from '@/lib/firebase-admin';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';

export const runtime = 'nodejs';


const JOB_RUNS_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'job_runs.read',
      rateLimit: JOB_RUNS_RATE_LIMIT,
    });
    const { id } = await params;
    const snap = await adminDb.doc(`workspaces/${ctx.workspaceId}/job_runs/${id}`).get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const data = snap.data()!;
    return Response.json({
      run: {
        id: snap.id,
        type: data.type,
        status: data.status,
        message: data.message || '',
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        startedAt: data.startedAt || null,
        finishedAt: data.finishedAt || null,
        details: data.details || {},
        createdAt: data.createdAt,
      },
    }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
