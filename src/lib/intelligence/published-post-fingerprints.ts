import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { createFingerprintJob } from './fingerprints';

/**
 * Background fingerprinting of published social posts so pattern learnings
 * (pillar, hook, format) and "why it worked" have something to read.
 *
 * Cost shape, deliberately bounded:
 *  - caption-only analysis (media is never copied or sent);
 *  - at most FINGERPRINT_ENQUEUE_PER_TICK new jobs per workspace tick;
 *  - at most FINGERPRINT_DAILY_CAP new jobs per workspace per UTC day;
 *  - the last 90 days first, older posts afterwards, then an hourly look at
 *    the newest 100 posts so fresh publishes and imports are picked up.
 * Jobs are system-owned and never counted against the user's AI quota.
 */
export const FINGERPRINT_ENQUEUE_PER_TICK = 20;
export const FINGERPRINT_SCAN_PAGE = 50;
export const FINGERPRINT_DAILY_CAP = 500;
export const FINGERPRINT_RECENT_WINDOW_DAYS = 90;
export const FINGERPRINT_INCREMENTAL_INTERVAL_MS = 3600_000;
export const FINGERPRINT_INCREMENTAL_SCAN = 100;
const MAX_CAPTION_CHARS = 30_000;

export type FingerprintBackfillState = {
  fingerprintRecentCursor?: string | null;
  fingerprintRecentDoneAt?: string;
  fingerprintOlderCursor?: string | null;
  fingerprintOlderDoneAt?: string;
  fingerprintIncrementalAt?: string;
  fingerprintDailyDate?: string;
  fingerprintDailyCount?: number;
};

export type FingerprintBackfillPhase = 'recent' | 'older' | 'incremental' | 'idle' | 'capped';

export type FingerprintBackfillResult = {
  phase: FingerprintBackfillPhase;
  scanned: number;
  queued: number;
  cachedApplied: number;
  skipped: number;
  done: boolean;
};

type SocialPostDoc = {
  productId?: unknown;
  content?: unknown;
  publishedAt?: unknown;
  fingerprint?: unknown;
  fingerprintQueuedAt?: unknown;
};

export function selectFingerprintPhase(state: FingerprintBackfillState, nowIso: string): FingerprintBackfillPhase {
  const today = nowIso.slice(0, 10);
  const dailyCount = state.fingerprintDailyDate === today ? (state.fingerprintDailyCount || 0) : 0;
  if (dailyCount >= FINGERPRINT_DAILY_CAP) return 'capped';
  if (!state.fingerprintRecentDoneAt) return 'recent';
  if (!state.fingerprintOlderDoneAt) return 'older';
  const last = state.fingerprintIncrementalAt ? Date.parse(state.fingerprintIncrementalAt) : 0;
  if (Date.parse(nowIso) - last >= FINGERPRINT_INCREMENTAL_INTERVAL_MS) return 'incremental';
  return 'idle';
}

/** Posts that still need a caption fingerprint; empty captions are not sent. */
export function needsFingerprint(post: SocialPostDoc): 'queue' | 'skip' {
  if (post.fingerprint && typeof post.fingerprint === 'object') return 'skip';
  if (typeof post.fingerprintQueuedAt === 'string' && post.fingerprintQueuedAt) return 'skip';
  if (typeof post.productId !== 'string' || !post.productId) return 'skip';
  if (typeof post.content !== 'string' || !post.content.trim()) return 'skip';
  return 'queue';
}

export async function enqueuePublishedPostFingerprints(
  workspaceId: string,
  nowIso: string,
  state: FingerprintBackfillState,
): Promise<{ result: FingerprintBackfillResult; metaUpdate: FingerprintBackfillState }> {
  const phase = selectFingerprintPhase(state, nowIso);
  const result: FingerprintBackfillResult = { phase, scanned: 0, queued: 0, cachedApplied: 0, skipped: 0, done: false };
  const metaUpdate: FingerprintBackfillState = {};
  if (phase === 'idle' || phase === 'capped') {
    result.done = true;
    return { result, metaUpdate };
  }

  const today = nowIso.slice(0, 10);
  const dailyCount = state.fingerprintDailyDate === today ? (state.fingerprintDailyCount || 0) : 0;
  const sinceIso = new Date(Date.parse(nowIso) - FINGERPRINT_RECENT_WINDOW_DAYS * 24 * 3600_000).toISOString();
  const collection = adminDb.collection(`workspaces/${workspaceId}/socialPosts`);

  let query = collection.orderBy('publishedAt', 'desc');
  let pageSize = FINGERPRINT_SCAN_PAGE;
  if (phase === 'recent') {
    query = collection.where('publishedAt', '>=', sinceIso).orderBy('publishedAt', 'desc');
    if (state.fingerprintRecentCursor) query = query.startAfter(state.fingerprintRecentCursor);
  } else if (phase === 'older') {
    query = collection.where('publishedAt', '<', sinceIso).orderBy('publishedAt', 'desc');
    if (state.fingerprintOlderCursor) query = query.startAfter(state.fingerprintOlderCursor);
  } else {
    pageSize = FINGERPRINT_INCREMENTAL_SCAN;
  }
  const snapshot = await query.limit(pageSize).get();

  let budget = Math.min(FINGERPRINT_ENQUEUE_PER_TICK, FINGERPRINT_DAILY_CAP - dailyCount);
  let lastCursor: string | null = null;
  let exhaustedBudget = false;
  for (const doc of snapshot.docs) {
    const post = doc.data() as SocialPostDoc;
    result.scanned += 1;
    if (needsFingerprint(post) === 'skip') {
      result.skipped += 1;
      lastCursor = typeof post.publishedAt === 'string' ? post.publishedAt : lastCursor;
      continue;
    }
    if (budget <= 0) {
      exhaustedBudget = true;
      break;
    }
    budget -= 1;
    const content = String(post.content).slice(0, MAX_CAPTION_CHARS);
    try {
      const job = await createFingerprintJob({
        workspaceId,
        uid: 'system',
        request: {
          productId: String(post.productId),
          kind: 'caption',
          content,
          sourcePostId: doc.id,
        },
        applyToSocialPostId: doc.id,
        system: true,
      });
      if (job.cached) {
        result.cachedApplied += 1;
      } else {
        await doc.ref.set({ fingerprintQueuedAt: nowIso, updatedAt: nowIso }, { merge: true });
        result.queued += 1;
      }
    } catch (error) {
      logger.warn('fingerprint enqueue failed', {
        event: 'intelligence.fingerprint_enqueue_failed',
        workspaceId,
        socialPostId: doc.id,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
    lastCursor = typeof post.publishedAt === 'string' ? post.publishedAt : lastCursor;
  }

  const newDailyCount = dailyCount + result.queued;
  if (result.queued > 0) {
    metaUpdate.fingerprintDailyDate = today;
    metaUpdate.fingerprintDailyCount = newDailyCount;
  }
  const pageExhausted = !exhaustedBudget && snapshot.size < pageSize;
  if (phase === 'recent') {
    if (lastCursor) metaUpdate.fingerprintRecentCursor = lastCursor;
    if (pageExhausted) {
      metaUpdate.fingerprintRecentDoneAt = nowIso;
      result.done = true;
    }
  } else if (phase === 'older') {
    if (lastCursor) metaUpdate.fingerprintOlderCursor = lastCursor;
    if (pageExhausted) {
      metaUpdate.fingerprintOlderDoneAt = nowIso;
      result.done = true;
    }
  } else if (!exhaustedBudget) {
    metaUpdate.fingerprintIncrementalAt = nowIso;
    result.done = true;
  }
  if (result.queued > 0 || result.cachedApplied > 0) {
    logger.info('published post fingerprints enqueued', {
      event: 'intelligence.fingerprint_backfill',
      workspaceId,
      phase,
      scanned: result.scanned,
      queued: result.queued,
      cachedApplied: result.cachedApplied,
    });
  }
  return { result, metaUpdate };
}
