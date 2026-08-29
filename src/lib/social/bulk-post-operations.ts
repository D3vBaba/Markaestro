/**
 * Bulk post operations.
 *
 * Every mutating post route is single-resource, so an agency rescheduling a
 * week of posts after a product delay does it one at a time, through dozens of
 * round trips, with no atomicity and no way to see what failed. This is the
 * shared engine behind the app and public API bulk endpoints.
 *
 * Partial success is the contract, not a failure mode: with 25 heterogeneous
 * posts, some legitimately cannot take the operation (one is mid-publish,
 * another was deleted in another tab), and refusing the whole batch for one of
 * them would make the endpoint unusable. Callers get `succeeded[]` and
 * `failed[{ id, error }]` and decide.
 */

import { adminDb } from '@/lib/firebase-admin';
import { assertPostMutable } from '@/lib/social/post-mutation-guards';
import { releasePostMedia } from '@/lib/media/asset-store';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';
import { isResettablePublishState } from '@/lib/schemas';

export { MAX_BULK_POST_ITEMS } from './bulk-post-schema';

export type BulkPostOperation =
  | { action: 'reschedule'; scheduledAt: string }
  | { action: 'delete' }
  | { action: 'status'; status: 'draft' | 'scheduled' };

export type BulkPostResult = {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
};

/**
 * Rescheduling is only meaningful for a post that has not gone out yet.
 * Moving a published post's `scheduledAt` would rewrite history without
 * changing anything on the platform, which is the same class of lie as
 * clearing a live post's `externalId`.
 */
function assertReschedulable(post: Record<string, unknown>) {
  const status = String(post.status || '');
  if (status === 'published' || status === 'partial_failed') {
    throw new Error('VALIDATION_POST_ALREADY_PUBLISHED');
  }
  if (!isResettablePublishState(status)) {
    throw new Error('VALIDATION_POST_NOT_RESCHEDULABLE');
  }
}

async function applyOne(
  workspaceId: string,
  uid: string,
  id: string,
  operation: BulkPostOperation,
): Promise<void> {
  const ref = adminDb.doc(`workspaces/${workspaceId}/posts/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('NOT_FOUND');
  const existing = snap.data() as Record<string, unknown>;

  // The same guard the single-resource routes apply: a post already handed to
  // the publisher must not be edited or deleted out from under it.
  assertPostMutable(existing, operation.action === 'delete' ? 'delete' : 'update');

  const now = new Date().toISOString();

  if (operation.action === 'delete') {
    await ref.delete();
    await releasePostMedia(workspaceId, existing.mediaUrls);
    return;
  }

  if (operation.action === 'reschedule') {
    assertReschedulable(existing);
    const timestamp = Date.parse(operation.scheduledAt);
    if (!Number.isFinite(timestamp)) throw new Error('VALIDATION_INVALID_SCHEDULED_AT');
    const scheduledAt = new Date(timestamp).toISOString();
    await ref.set({
      status: 'scheduled',
      scheduledAt,
      updatedAt: now,
      updatedBy: uid,
    }, { merge: true });
    return;
  }

  // status change
  if (operation.status === 'scheduled' && !existing.scheduledAt) {
    throw new Error('VALIDATION_SCHEDULED_AT_REQUIRED');
  }
  assertReschedulable(existing);
  await ref.set({
    status: operation.status,
    updatedAt: now,
    updatedBy: uid,
  }, { merge: true });
}

/**
 * Apply one operation across a bounded set of posts.
 *
 * Sequential on purpose. A bulk reschedule writes to the same workspace's due
 * marker and a bulk delete writes reference counts on shared media assets;
 * running 25 of those concurrently buys little and contends on documents the
 * batch itself created.
 */
export async function applyBulkPostOperation(
  workspaceId: string,
  uid: string,
  ids: string[],
  operation: BulkPostOperation,
): Promise<BulkPostResult> {
  const result: BulkPostResult = { succeeded: [], failed: [] };

  for (const id of ids) {
    try {
      await applyOne(workspaceId, uid, id, operation);
      result.succeeded.push(id);
    } catch (error) {
      result.failed.push({
        id,
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      });
    }
  }

  // One due marker for the whole batch rather than one per post: the worker
  // only needs to know the earliest time it has work.
  if (operation.action === 'reschedule' && result.succeeded.length > 0) {
    await markWorkspaceDue(workspaceId, operation.scheduledAt, 'scheduled_post').catch(() => undefined);
  }

  return result;
}
