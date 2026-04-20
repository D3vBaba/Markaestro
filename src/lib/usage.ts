import { adminDb } from '@/lib/firebase-admin';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { PLANS } from '@/lib/stripe/plans';
import type { PlanTier } from '@/lib/stripe/plans';

export type UsageType = 'aiGenerations';

export type UsageCheckResult = {
  allowed: boolean;
  current: number;
  limit: number;
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // e.g. "2026-03"
}

function usageScopeId(uid: string, workspaceId?: string): string {
  return workspaceId ? `workspace:${workspaceId}` : `user:${uid}`;
}

/**
 * Atomically checks whether a user is within their quota for the given generation
 * type, and if so, increments the counter. Returns whether the request is allowed.
 *
 * Usage counters are stored in Firestore under `usage/{uid}` with field names
 * like `2026-03_aiGenerations`. This resets naturally each month as the field
 * key changes.
 */
export async function checkAndIncrementUsage(
  uid: string,
  type: UsageType,
  workspaceId?: string,
): Promise<UsageCheckResult> {
  const sub = await getEffectiveSubscription(uid, workspaceId);

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
  const docRef = adminDb.collection('usage').doc(usageScopeId(uid, workspaceId));

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
 * Refund `n` units of usage that were optimistically incremented but
 * ultimately not consumed (e.g., downstream provider error after
 * checkAndIncrementUsage returned allowed=true).
 *
 * Uses FieldValue.increment(-n) to avoid lost updates under contention,
 * and clamps at 0 in a follow-up transaction only if the counter would
 * go negative — most refunds complete on the atomic path.
 */
export async function refundUsage(
  uid: string,
  type: UsageType,
  count: number,
  workspaceId?: string,
): Promise<void> {
  if (!count || count <= 0) return;
  const month = currentMonth();
  const field = `${month}_${type}`;
  const docRef = adminDb.collection('usage').doc(usageScopeId(uid, workspaceId));
  const { FieldValue } = await import('firebase-admin/firestore');
  try {
    await docRef.set({ [field]: FieldValue.increment(-count) }, { merge: true });
  } catch (err) {
    console.warn('[usage.refund] atomic decrement failed, falling back', err);
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const current = (snap.data()?.[field] as number) ?? 0;
      const next = Math.max(0, current - count);
      tx.set(docRef, { [field]: next }, { merge: true });
    });
    return;
  }
  // Best-effort clamp if the atomic decrement went negative (race with a
  // concurrent reset or manual admin edit).
  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const current = (snap.data()?.[field] as number) ?? 0;
      if (current < 0) tx.set(docRef, { [field]: 0 }, { merge: true });
    });
  } catch {
    // non-fatal
  }
}

/**
 * Returns the current month's usage counts for a user without modifying them.
 * Useful for displaying remaining quota in the UI.
 */
export async function getUsage(
  uid: string,
  workspaceId?: string,
): Promise<{ aiGenerations: number }> {
  const month = currentMonth();
  const snap = await adminDb.collection('usage').doc(usageScopeId(uid, workspaceId)).get();
  const data = snap.data() ?? {};
  return {
    aiGenerations: (data[`${month}_aiGenerations`] as number) ?? 0,
  };
}
