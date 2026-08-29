/**
 * `job_runs` records for every publish path.
 *
 * The public API created a run document, exposed it at
 * `GET /api/public/v1/job-runs/[id]`, and emitted `post.publish.queued`. The
 * app's own publish and the scheduler did none of that, so a webhook
 * subscriber saw `queued` only for API-initiated publishes and the app had no
 * equivalent of the run history integrators get. A webhook whose event stream
 * depends on which button started the work is not much of a webhook.
 *
 * Relationship to the publish attempt trail: `publishAttempts` is the detail
 * table (one row per channel per retry) and `job_runs` is the coarse,
 * client-facing summary (one per publish request) that points at the post the
 * attempts hang off. Both are useful; this is the summary.
 */

import { adminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { enqueueWebhookEvent } from '@/lib/public-api/webhooks';
import { logger } from '@/lib/logger';

const PUBLISH_RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Which surface asked for the publish. Recorded so runs stay attributable. */
export type PublishRunSource = 'app_immediate' | 'scheduler' | 'public_api';

export type PublishRunOutcome =
  | 'succeeded'
  | 'failed'
  | 'partial_failed'
  | 'action_required'
  | 'pending';

type StartPublishRunInput = {
  workspaceId: string;
  postId: string;
  source: PublishRunSource;
  channel?: unknown;
  createdByType?: unknown;
  createdById?: unknown;
};

/**
 * Open a run for a publish that executes inline (the app button and the
 * scheduler both publish synchronously, unlike the API's queue-and-worker).
 * It is therefore created as `running`, not `queued`, and closed by
 * {@link finishPublishRun}.
 *
 * Best-effort throughout: the publish itself is the user's actual intent, and
 * failing to write a history row must never be the reason it does not happen.
 * Returns the run id, or null if the record could not be written.
 */
export async function startPublishRun(input: StartPublishRunInput): Promise<string | null> {
  const now = new Date().toISOString();
  try {
    const ref = adminDb.collection(`workspaces/${input.workspaceId}/job_runs`).doc();
    await ref.set({
      id: ref.id,
      type: 'publish_post',
      resourceType: 'post',
      resourceId: input.postId,
      status: 'running',
      source: input.source,
      message: 'Publish started',
      details: {},
      createdByType: typeof input.createdByType === 'string' ? input.createdByType : 'user',
      createdById: typeof input.createdById === 'string' ? input.createdById : '',
      attemptCount: 1,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      expiresAt: Timestamp.fromMillis(Date.now() + PUBLISH_RUN_RETENTION_MS),
    });

    await enqueueWebhookEvent(input.workspaceId, 'post.publish.queued', {
      postId: input.postId,
      channel: input.channel ?? '',
      status: 'running',
      runId: ref.id,
      source: input.source,
    });

    return ref.id;
  } catch (error) {
    logger.warn('publish run record could not be opened', {
      event: 'publish.run_record_failed',
      workspaceId: input.workspaceId,
      postId: input.postId,
      source: input.source,
      err: error,
    });
    return null;
  }
}

/**
 * Close a run opened by {@link startPublishRun}. A `pending` outcome leaves it
 * running, because the work genuinely has not finished: TikTok's inbox
 * hand-off is resolved later by the poll worker.
 */
export async function finishPublishRun(
  workspaceId: string,
  runId: string | null,
  outcome: PublishRunOutcome,
  message = '',
): Promise<void> {
  if (!runId) return;
  const now = new Date().toISOString();
  try {
    await adminDb.doc(`workspaces/${workspaceId}/job_runs/${runId}`).set({
      status: outcome === 'pending' ? 'running' : outcome,
      message: message.slice(0, 500),
      finishedAt: outcome === 'pending' ? null : now,
    }, { merge: true });
  } catch (error) {
    logger.warn('publish run record could not be closed', {
      event: 'publish.run_record_finish_failed',
      workspaceId,
      runId,
      err: error,
    });
  }
}
