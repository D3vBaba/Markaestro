import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { deleteAccountEntitlement } from '@/lib/stripe/subscription';
import { getStripe } from '@/lib/stripe/server';
import { listPendingInvitesForEmail } from '@/lib/team-invites';
import { logger } from '@/lib/logger';
import { listMembershipsForUid, purgeWorkspace, splitOwnedAndJoined } from '@/lib/workspace-delete';

async function cancelLegacyUidSubscription(uid: string): Promise<void> {
  const snap = await adminDb.doc(`subscriptions/${uid}`).get();
  if (!snap.exists) return;
  const data = snap.data() as { stripeSubscriptionId?: string; status?: string } | undefined;
  if (data?.stripeSubscriptionId && data.status !== 'canceled') {
    try {
      await getStripe().subscriptions.cancel(data.stripeSubscriptionId);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== 'resource_missing') throw err;
    }
  }
  await snap.ref.delete();
}

/**
 * Permanently delete a user: workspaces they own, memberships in others,
 * pending invites addressed to them, billing, then the Auth user.
 */
export async function deleteAccount(uid: string, email: string): Promise<{ deletedWorkspaceIds: string[] }> {
  const memberships = await listMembershipsForUid(uid);
  const { ownedIds, joinedIds } = splitOwnedAndJoined(memberships);

  for (const workspaceId of ownedIds) {
    await purgeWorkspace(workspaceId);
  }

  for (const workspaceId of joinedIds) {
    await adminDb.doc(`workspaces/${workspaceId}/members/${uid}`).delete();
  }

  if (email) {
    try {
      const invites = await listPendingInvitesForEmail(email);
      await Promise.all(
        invites.map((invite) =>
          adminDb.doc(`workspaces/${invite.workspaceId}/pendingInvites/${email.trim().toLowerCase()}`).delete(),
        ),
      );
    } catch (err) {
      logger.warn('account delete invite cleanup failed', {
        event: 'account.delete.invites_failed',
        uid,
        err,
      });
    }
  }

  await cancelLegacyUidSubscription(uid);
  await deleteAccountEntitlement(uid);

  await adminAuth.revokeRefreshTokens(uid);
  await adminAuth.deleteUser(uid);

  return { deletedWorkspaceIds: ownedIds };
}
