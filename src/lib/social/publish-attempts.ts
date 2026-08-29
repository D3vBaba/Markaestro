/**
 * Append-only record of every publish attempt, one document per channel per
 * attempt.
 *
 * The post document holds `errorMessage`, `lastErrorCode`, and
 * `lastErrorCategory`, and every attempt overwrites them. So attempts 1
 * through 3 of a post that succeeded on the fourth are unrecoverable, and
 * neither "why did this take four tries" nor "did this ever succeed on
 * Instagram" can be answered after the fact. This is the detail table that
 * answers both, and the substrate that makes the publish-failure alert in
 * `docs/operations/alerting.md` actionable rather than merely loud.
 *
 * `job_runs` stays the coarse, client-facing summary (one per publish
 * request); this is the fine-grained record underneath it.
 */

import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import type { SocialChannel } from '@/lib/schemas';

/** Matches the 90-day window in docs/operations/firestore-ttl.md. */
export const PUBLISH_ATTEMPT_RETENTION_MS = 90 * 24 * 60 * 60_000;

/**
 * Platform errors can be entire HTTP bodies. Keep enough to recognize the
 * failure, never enough to turn this collection into a copy of the provider's
 * response log.
 */
const MAX_RAW_ERROR_LENGTH = 500;

export type PublishAttemptOutcome =
  | 'published'
  | 'pending'
  | 'action_required'
  | 'failed'
  | 'retry_scheduled';

export type PublishAttemptRecord = {
  attemptId: string;
  attemptNumber: number;
  channel: SocialChannel | string;
  outcome: PublishAttemptOutcome;
  startedAt: string;
  finishedAt: string;
  externalId?: string | null;
  externalUrl?: string | null;
  errorCode?: string | null;
  errorCategory?: string | null;
  /** The platform's own error text, truncated. */
  rawError?: string | null;
};

export function truncateRawError(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_RAW_ERROR_LENGTH
    ? `${trimmed.slice(0, MAX_RAW_ERROR_LENGTH)}…`
    : trimmed;
}

/**
 * Write one attempt row per channel.
 *
 * Best-effort by design and never throws: the publish outcome has already
 * been decided and written to the post by the time this runs, and losing an
 * audit row must not turn a successful publish into a failed one. A failure
 * is logged so the gap is visible rather than silent.
 */
export async function recordPublishAttempt(
  workspaceId: string,
  postId: string,
  attempts: PublishAttemptRecord[],
): Promise<void> {
  if (attempts.length === 0) return;

  try {
    const collection = adminDb.collection(
      `workspaces/${workspaceId}/posts/${postId}/publishAttempts`,
    );
    const batch = adminDb.batch();
    const expiresAt = Timestamp.fromMillis(Date.now() + PUBLISH_ATTEMPT_RETENTION_MS);

    for (const attempt of attempts) {
      // One document per (attempt, channel): the attempt id alone collides on
      // a multi-channel post, which would silently keep only the last channel.
      batch.set(collection.doc(`${attempt.attemptId}_${attempt.channel}`), {
        id: `${attempt.attemptId}_${attempt.channel}`,
        workspaceId,
        postId,
        attemptId: attempt.attemptId,
        attemptNumber: attempt.attemptNumber,
        channel: attempt.channel,
        outcome: attempt.outcome,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        externalId: attempt.externalId || null,
        externalUrl: attempt.externalUrl || null,
        errorCode: attempt.errorCode || null,
        errorCategory: attempt.errorCategory || null,
        rawError: truncateRawError(attempt.rawError),
        expiresAt,
      });
    }

    await batch.commit();
  } catch (error) {
    logger.warn('publish attempt trail write failed', {
      event: 'publish.attempt_trail_failed',
      workspaceId,
      postId,
      attempts: attempts.length,
      err: error,
    });
  }
}

/** Newest-first attempt history for one post. */
export async function listPublishAttempts(
  workspaceId: string,
  postId: string,
  limit = 50,
): Promise<Array<Record<string, unknown>>> {
  const snapshot = await adminDb
    .collection(`workspaces/${workspaceId}/posts/${postId}/publishAttempts`)
    .orderBy('finishedAt', 'desc')
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => doc.data());
}

export function newPublishAttemptId(): string {
  return randomUUID();
}
