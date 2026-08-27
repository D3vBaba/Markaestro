import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { requireIntelligencePreviewUser } from '@/lib/intelligence/preview-access';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireIntelligencePreviewUser(ctx);
    requirePermission(ctx, 'intelligence.read');
    const { id } = await params;
    const job = await adminDb.doc(`workspaces/${ctx.workspaceId}/intelligenceJobs/${id}`).get();
    if (!job.exists) throw new Error('NOT_FOUND');
    const data = job.data() || {};
    let fingerprint = null;
    if (data.status === 'complete' && typeof data.resultRef === 'string') {
      const result = await adminDb.doc(`workspaces/${ctx.workspaceId}/${data.resultRef}`).get();
      fingerprint = result.data()?.fingerprint ?? null;
    }
    return apiOk({
      jobId: id,
      status: data.status,
      cacheHit: data.cacheHit ?? false,
      fingerprint,
      result: data.result ?? null,
      errorCode: data.status === 'dead_letter' ? data.lastErrorCode || 'ANALYSIS_FAILED' : null,
      updatedAt: data.updatedAt || null,
    });
  } catch (error) {
    return apiError(error);
  }
}
