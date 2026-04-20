/**
 * POST /api/worker/workspace/[workspaceId]
 *
 * Single-workspace worker tick, designed to be invoked once per
 * workspace by Cloud Tasks (or another fan-out mechanism). Allows the
 * global dispatcher to stay under the Cloud Run request timeout even as
 * the number of workspaces grows into the thousands.
 *
 * Authentication: same `x-worker-secret` header as the dispatcher tick.
 * The secret is a shared symmetric key — keep in Secret Manager and
 * rotate with `scripts/setup-cloud-scheduler.sh`.
 */

import { safeCompare } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { processWorkspaceTick } from '@/lib/workers/workspace-tick';
import { isValidWorkspaceId } from '@/lib/workspace';
import { logger, requestIdFromHeaders } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const requestId = requestIdFromHeaders(req.headers);
  try {
    const secret = process.env.WORKER_SECRET || '';
    const token = req.headers.get('x-worker-secret') || '';
    if (!secret || !safeCompare(token, secret)) {
      throw new Error('UNAUTHENTICATED');
    }

    const { workspaceId } = await params;
    if (!isValidWorkspaceId(workspaceId)) {
      throw new Error('VALIDATION_INVALID_WORKSPACE_ID');
    }

    const result = await processWorkspaceTick(workspaceId);
    logger.info('workspace tick processed (direct)', {
      event: 'worker.workspace_tick_direct',
      requestId,
      workspaceId,
      durationMs: result.durationMs,
    });
    return apiOk(result);
  } catch (error) {
    return apiError(error);
  }
}
