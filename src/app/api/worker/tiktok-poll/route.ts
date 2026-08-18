import { pollPendingTikTokPublishes } from '@/lib/social/tiktok-publish-poll-worker';
import { safeCompare } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { logger, requestIdFromHeaders } from '@/lib/logger';
import { acquireWorkerLease, releaseWorkerLease } from '@/lib/workers/lease';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const requestId = requestIdFromHeaders(req.headers);
  let leaseId: string | null = null;
  try {
    const secret = process.env.WORKER_SECRET || '';
    const token = req.headers.get('x-worker-secret') || '';
    if (!secret || !safeCompare(token, secret)) {
      throw new Error('UNAUTHENTICATED');
    }

    leaseId = await acquireWorkerLease('tiktok-poll', 2 * 60_000);
    if (!leaseId) {
      return apiOk({ ok: true, skipped: 'already_running', iterations: [] });
    }

    const started = Date.now();
    const result = await pollPendingTikTokPublishes();
    const summary = {
      polled: result.polled,
      completed: result.completed,
      failed: result.failed,
      pending: result.pending,
      errors: result.errors.length,
    };

    if (result.errors.length > 0) {
      logger.warn('tiktok poll errors', {
        event: 'worker.tiktok_fast_poll_iteration',
        requestId,
        iteration: 0,
        errors: result.errors,
      });
    }

    logger.info('tiktok poll completed', {
      event: 'worker.tiktok_fast_poll',
      requestId,
      iterations: 1,
      durationMs: Date.now() - started,
      ...summary,
    });

    return apiOk({ ok: true, iterations: [summary] });
  } catch (error) {
    return apiError(error);
  } finally {
    if (leaseId) {
      await releaseWorkerLease('tiktok-poll', leaseId).catch((error) => {
        logger.warn('tiktok worker lease release failed', {
          event: 'worker.tiktok_fast_poll_lease_release_failed',
          requestId,
          err: error,
        });
      });
    }
  }
}
