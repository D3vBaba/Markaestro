import { adminDb } from '@/lib/firebase-admin';
import { getSubscription } from '@/lib/stripe/subscription';
import { PLANS } from '@/lib/stripe/plans';
import type { PlanTier } from '@/lib/stripe/plans';

export type UsageType = 'aiGenerations' | 'videoGenerations';

export type UsageCheckResult = {
  allowed: boolean;
  current: number;
  limit: number;
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // e.g. "2026-03"
}

/**
 * Atomically checks whether a user is within their quota for the given generation
 * type, and if so, increments the counter. Returns whether the request is allowed.
 *
 * Usage counters are stored in Firestore under `usage/{uid}` with field names
 * like `2026-03_aiGenerations` and `2026-03_videoGenerations`. This resets
 * naturally each month as the field key changes.
 */
export async function checkAndIncrementUsage(
  uid: string,
  type: UsageType,
): Promise<UsageCheckResult> {
  const sub = await getSubscription(uid);

  if (!sub || !['active', 'trialing'].includes(sub.status)) {
    return { allowed: false, current: 0, limit: 0 };
  }

  const tier = sub.tier as PlanTier;
  const plan = PLANS[tier];
  if (!plan) return { allowed: false, current: 0, limit: 0 };

  const limit = plan.limits[type];

  // 0 = feature not available on this plan
  if (limit === 0) {
    return { allowed: false, current: 0, limit: 0 };
  }

  // -1 = unlimited (legacy safety valve)
  if (limit === -1) {
    return { allowed: true, current: 0, limit: -1 };
  }

  const month = currentMonth();
  const field = `${month}_${type}`;
  const docRef = adminDb.collection('usage').doc(uid);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const current = (snap.data()?.[field] as number) ?? 0;

    if (current >= limit) {
      return { allowed: false, current, limit };
    }

    tx.set(docRef, { [field]: current + 1 }, { merge: true });
    return { allowed: true, current: current + 1, limit };
  });
}

/**
 * Returns the current month's usage counts for a user without modifying them.
 * Useful for displaying remaining quota in the UI.
 */
export async function getUsage(uid: string): Promise<{ aiGenerations: number; videoGenerations: number }> {
  const month = currentMonth();
  const snap = await adminDb.collection('usage').doc(uid).get();
  const data = snap.data() ?? {};
  return {
    aiGenerations: (data[`${month}_aiGenerations`] as number) ?? 0,
    videoGenerations: (data[`${month}_videoGenerations`] as number) ?? 0,
  };
}
