import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { isValidWorkspaceId, PENDING_WORKSPACE_ID } from '@/lib/workspace';
import { getStripe } from '@/lib/stripe/server';
import { deleteSubscriptionForWorkspace, getSubscriptionForWorkspace } from '@/lib/stripe/subscription';
import { deleteStoragePrefix } from '@/lib/storage';
import { type WorkspaceMembership } from '@/lib/delete-helpers';

export type { WorkspaceMembership } from '@/lib/delete-helpers';
export { splitOwnedAndJoined } from '@/lib/delete-helpers';

async function cancelStripeSubscription(stripeSubscriptionId: string | undefined, status: string | undefined): Promise<void> {
  if (!stripeSubscriptionId || status === 'canceled') return;
  try {
    await getStripe().subscriptions.cancel(stripeSubscriptionId);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== 'resource_missing') throw err;
  }
}

/**
 * Cancel billing then delete the workspace tree. Stripe is first so a
 * failure leaves the workspace intact and still billed — never deleted
 * while a live subscription keeps charging.
 */
export async function purgeWorkspace(workspaceId: string): Promise<void> {
  if (!isValidWorkspaceId(workspaceId) || workspaceId === PENDING_WORKSPACE_ID) {
    throw new Error('VALIDATION_INVALID_WORKSPACE_ID');
  }

  const sub = await getSubscriptionForWorkspace(workspaceId);
  await cancelStripeSubscription(sub?.stripeSubscriptionId, sub?.status);
  await deleteSubscriptionForWorkspace(workspaceId);
  await adminDb.doc(`usage/workspace:${workspaceId}`).delete();
  await adminDb.recursiveDelete(adminDb.doc(`workspaces/${workspaceId}`));

  try {
    await deleteStoragePrefix(`workspaces/${workspaceId}/`);
  } catch (err) {
    logger.warn('workspace storage cleanup failed', {
      event: 'workspace.delete.storage_failed',
      workspaceId,
      err,
    });
  }
}

export async function listMembershipsForUid(uid: string): Promise<WorkspaceMembership[]> {
  const snap = await adminDb.collectionGroup('members').where('uid', '==', uid).get();
  return snap.docs
    .map((doc) => ({
      workspaceId: doc.ref.path.split('/')[1] || '',
      role: (doc.data().role as string) || 'member',
    }))
    .filter((membership) => Boolean(membership.workspaceId) && membership.workspaceId !== PENDING_WORKSPACE_ID);
}
