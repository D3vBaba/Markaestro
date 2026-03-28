import { adminDb } from '@/lib/firebase-admin';
import type { SubscriptionRecord } from './server';
import type { PlanTier } from './plans';

const COLLECTION = 'subscriptions';

export async function getSubscription(uid: string): Promise<SubscriptionRecord | null> {
  const doc = await adminDb.collection(COLLECTION).doc(uid).get();
  if (!doc.exists) return null;
  return doc.data() as SubscriptionRecord;
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

  const activeStatuses = ['active', 'trialing'];
  const active = activeStatuses.includes(sub.status);

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
