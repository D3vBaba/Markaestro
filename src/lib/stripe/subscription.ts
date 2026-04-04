import { adminDb } from '@/lib/firebase-admin';
import type { SubscriptionRecord } from './server';
import type { PlanTier } from './plans';

const COLLECTION = 'subscriptions';
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

async function getWorkspaceOwnerIds(workspaceId: string): Promise<string[]> {
  const ownersSnap = await adminDb
    .collection(`workspaces/${workspaceId}/members`)
    .where('role', '==', 'owner')
    .limit(20)
    .get();

  return ownersSnap.docs.map((doc) => doc.id);
}

export async function getSubscription(uid: string): Promise<SubscriptionRecord | null> {
  const doc = await adminDb.collection(COLLECTION).doc(uid).get();
  if (!doc.exists) return null;
  return doc.data() as SubscriptionRecord;
}

function subscriptionPriority(sub: SubscriptionRecord | null): number {
  if (!sub) return -1;
  if (ACTIVE_STATUSES.has(sub.status)) return 2;
  if (sub.status === 'past_due') return 1;
  return 0;
}

export async function getWorkspaceSubscription(workspaceId: string): Promise<SubscriptionRecord | null> {
  const ownerIds = await getWorkspaceOwnerIds(workspaceId);
  if (ownerIds.length === 0) {
    return null;
  }

  const ownerSubs = await Promise.all(
    ownerIds.map((ownerId) => getSubscription(ownerId)),
  );

  const ranked = ownerSubs
    .filter((sub): sub is SubscriptionRecord => Boolean(sub))
    .sort((a, b) => {
      const priorityDiff = subscriptionPriority(b) - subscriptionPriority(a);
      if (priorityDiff !== 0) return priorityDiff;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });

  return ranked[0] ?? null;
}

export async function getEffectiveSubscription(
  uid: string,
  workspaceId?: string,
): Promise<SubscriptionRecord | null> {
  if (workspaceId) {
    const ownerIds = await getWorkspaceOwnerIds(workspaceId);
    if (ownerIds.length > 0) {
      return getWorkspaceSubscription(workspaceId);
    }
  }

  return getSubscription(uid);
}

export async function upsertSubscription(uid: string, data: Partial<SubscriptionRecord>) {
  await adminDb.collection(COLLECTION).doc(uid).set(
    { ...data, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

export async function deleteSubscription(uid: string) {
  await adminDb.collection(COLLECTION).doc(uid).delete();
}

export async function findUidByCustomerId(customerId: string): Promise<string | null> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where('stripeCustomerId', '==', customerId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

export type SubscriptionStatus = {
  active: boolean;
  tier: PlanTier | null;
  interval: string | null;
  trialing: boolean;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
};

export function resolveStatus(sub: SubscriptionRecord | null): SubscriptionStatus {
  if (!sub) {
    return {
      active: false,
      tier: null,
      interval: null,
      trialing: false,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    };
  }

  const active = ACTIVE_STATUSES.has(sub.status);

  return {
    active,
    tier: (sub.tier as PlanTier) || null,
    interval: sub.interval || null,
    trialing: sub.status === 'trialing',
    trialEnd: sub.trialEnd || null,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd || false,
    currentPeriodEnd: sub.currentPeriodEnd || null,
  };
}
