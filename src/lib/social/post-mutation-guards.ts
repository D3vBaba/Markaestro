/**
 * Guards that protect a post document from being mutated out from under the
 * publisher.
 *
 * The publisher takes a lease (`publishLeaseExpiresAt`) before it starts
 * calling platform APIs, and `recoverStalePublishingPosts()` sweeps posts whose
 * lease has expired. Neither prevents the document being edited or deleted
 * mid-flight, which is what these guards are for: an edit can rewrite the
 * content the publisher is already holding, and a delete leaves a live post on
 * the platform with no record of it here.
 *
 * Both surfaces (the app's `/api/posts/[id]` and the public API) import from
 * here so the rule cannot drift between them.
 */

import { ApiValidationError } from '@/lib/api-response';

export type PostMutation = 'update' | 'delete';

const PUBLISHING_STATUS = 'publishing';

/** How long a client should wait before retrying a blocked mutation. */
const RETRY_AFTER_SECONDS = 60;

/**
 * True when the post is being published *right now* by a live publisher run.
 *
 * A post stuck in `publishing` because a Cloud Run instance died mid-run has an
 * expired lease and is NOT locked: recovery will reclaim it, and until then the
 * user must still be able to delete it. Gating on the bare status instead would
 * turn a crash into a permanently undeletable post.
 */
export function isPublishInFlight(post: Record<string, unknown>, now: Date = new Date()): boolean {
  if (post.status !== PUBLISHING_STATUS) return false;
  const lease = post.publishLeaseExpiresAt;
  // No lease recorded at all: treat as in-flight. The publisher writes the
  // lease and the status together, so a missing lease means an old document
  // shape rather than a dead run, and refusing is the safe direction.
  if (typeof lease !== 'string' || !lease) return true;
  return lease > now.toISOString();
}

/**
 * Throw if `post` must not be updated or deleted because a publish is running.
 */
export function assertPostMutable(
  post: Record<string, unknown>,
  op: PostMutation,
  now: Date = new Date(),
): void {
  if (!isPublishInFlight(post, now)) return;
  throw new ApiValidationError(
    'VALIDATION_POST_IS_PUBLISHING',
    op === 'delete'
      ? 'This post is being published right now. Wait for it to finish, then delete it.'
      : 'This post is being published right now. Wait for it to finish, then edit it.',
    { status: PUBLISHING_STATUS, operation: op, retryAfterSeconds: RETRY_AFTER_SECONDS },
  );
}
