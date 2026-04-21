import { pollPendingTikTokPublishes } from '@/lib/social/tiktok-publish-poll-worker';
import { safeCompare } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { logger, requestIdFromHeaders } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Cloud Scheduler's minimum cadence is 1 minute, but TikTok inbox
// transcoding usually finishes in 15–45s. Each invocation polls twice,
// spaced 30s apart, so a publish lingers in `publishing` for ~30s at
// most once TikTok is ready — without changing the main worker tick.
const POLL_ITERATIONS = 2;
const POLL_SPACING_MS = 30_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: Request) {
  const requestId = requestIdFromHeaders(req.headers);
  try {
    const secret = process.env.WORKER_SECRET || '';
    const token = req.headers.get('x-worker-secret') || '';
    if (!secret || !safeCompare(token, secret)) {
      throw new Error('UNAUTHENTICATED');
    }

    const started = Date.now();
    const iterations: Array<{
      polled: number;
      completed: number;
      failed: number;
      pending: number;
      errors: number;
    }> = [];

    for (let i = 0; i < POLL_ITERATIONS; i++) {
      if (i > 0) await sleep(POLL_SPACING_MS);
      try {
        const result = await pollPendingTikTokPublishes();
        iterations.push({
          polled: result.polled,
          completed: result.completed,
          failed: result.failed,
          pending: result.pending,
          errors: result.errors.length,
        });
        if (result.errors.length > 0) {
          logger.warn('tiktok fast poll iteration errors', {
            event: 'worker.tiktok_fast_poll_iteration',
            requestId,
            iteration: i,
            errors: result.errors,
          });
        }
      } catch (e) {
        logger.error('tiktok fast poll iteration failed', {
          event: 'worker.tiktok_fast_poll_iteration',
          requestId,
          iteration: i,
          err: e,
        });
      }

      // Bail early if nothing was pending on this pass — saves the
      // 30s sleep and the redundant Firestore scan.
      const last = iterations[iterations.length - 1];
      if (last && last.polled === 0) break;
    }

    logger.info('tiktok fast poll completed', {
      event: 'worker.tiktok_fast_poll',
      requestId,
      iterations: iterations.length,
      durationMs: Date.now() - started,
    });

    return apiOk({ ok: true, iterations });
  } catch (error) {
    return apiError(error);
  }
}
