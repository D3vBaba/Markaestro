import { adminDb } from '@/lib/firebase-admin';
import { effectiveTier, getEffectiveSubscription } from './subscription';

/** Recheck at execution time: queued posts must not outlive paid access. */
export async function requirePaidPublishing(workspaceId: string, uid?: string): Promise<void> {
  const subscription = await getEffectiveSubscription({ workspaceId, uid });
  if (effectiveTier(subscription) !== 'free') return;

  // Background work has no signed-in user. Honor the workspace owner's
  // existing account-level grant, including app-review accounts.
  if (!uid) {
    const workspace = await adminDb.doc(`workspaces/${workspaceId}`).get();
    const owner = workspace.data()?.createdBy;
    if (typeof owner === 'string') {
      const ownedSubscription = await getEffectiveSubscription({ workspaceId, uid: owner });
      if (effectiveTier(ownedSubscription) !== 'free') return;
    }
  }
  throw new Error('SUBSCRIPTION_REQUIRED');
}
