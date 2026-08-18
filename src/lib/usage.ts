import { adminDb } from '@/lib/firebase-admin';
import { getEffectiveSubscription, effectiveTier } from '@/lib/stripe/subscription';
import { PLANS } from '@/lib/stripe/plans';
import type { PlanLimits } from '@/lib/stripe/plans';

export type UsageType = 'mediaUploads' | 'posts';

const LIMIT_KEY: Record<UsageType, keyof PlanLimits> = {
  mediaUploads: 'mediaUploads',
  posts: 'postsPerMonth',
};

export type UsageCheckResult = {
  allowed: boolean;
  current: number;
  limit: number;
  reason?: 'subscription_required' | 'quota_exceeded';
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // e.g. "2026-03"
}

function usageScopeId(uid: string, workspaceId?: string): string {
  return workspaceId ? `workspace:${workspaceId}` : `user:${uid}`;
}

export async function checkAndIncrementUsage(
  uid: string,
  type: UsageType,
  workspaceId?: string,
): Promise<UsageCheckResult> {
  // Workspaces without an active subscription resolve to the 'free' tier and
  // meter against its limits rather than being blocked outright.
  const sub = await getEffectiveSubscription(uid, workspaceId);
  const plan = PLANS[effectiveTier(sub)];

  const limit = plan.limits[LIMIT_KEY[type]];

  if (limit === 0) {
    return { allowed: false, current: 0, limit: 0, reason: 'quota_exceeded' };
  }

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
      return { allowed: false, current, limit, reason: 'quota_exceeded' };
    }

    tx.set(docRef, { [field]: current + 1 }, { merge: true });
    return { allowed: true, current: current + 1, limit };
  });
}

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

export async function getUsage(
  uid: string,
  workspaceId?: string,
): Promise<{ mediaUploads: number; posts: number }> {
  const month = currentMonth();
  const snap = await adminDb.collection('usage').doc(usageScopeId(uid, workspaceId)).get();
  const data = snap.data() ?? {};
  return {
    mediaUploads: (data[`${month}_mediaUploads`] as number) ?? 0,
    posts: (data[`${month}_posts`] as number) ?? 0,
  };
}
