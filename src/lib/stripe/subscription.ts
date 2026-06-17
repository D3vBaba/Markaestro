import { adminDb } from '@/lib/firebase-admin';
import type { SubscriptionRecord } from './server';
import type { PlanTier } from './plans';

/**
 * Subscriptions are keyed by workspaceId. The Stripe customer + subscription
 * live on the workspace, not on a single Firebase user, so that ownership
 * transfers and multi-owner teams don't lose billing state.
 *
 * Legacy data (`subscriptions/{uid}`) is handled by reading both keys in
 * `getEffectiveSubscription`. A one-shot migration
 * (`scripts/backfill-workspace-subscriptions.mjs`) copies any uid-keyed
 * records onto the corresponding workspaceId.
 */
const COLLECTION = 'subscriptions';
/**
 * Account-level entitlements, keyed by Firebase uid. Unlike `subscriptions`
 * (which belong to a workspace), an entitlement here grants its plan to the
 * user in EVERY workspace they're in. Used for manual comps (e.g. reviewer /
 * tester accounts) and any future per-user plan. `getEffectiveSubscription`
 * lets an active account entitlement override the workspace subscription.
 */
const ACCOUNT_COLLECTION = 'accountEntitlements';
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export async function getSubscriptionForWorkspace(workspaceId: string): Promise<SubscriptionRecord | null> {
  const doc = await adminDb.collection(COLLECTION).doc(workspaceId).get();
  if (!doc.exists) return null;
  return doc.data() as SubscriptionRecord;
}

/** Read the account-level entitlement for a user (applies across all workspaces). */
export async function getAccountEntitlement(uid: string): Promise<SubscriptionRecord | null> {
  const doc = await adminDb.collection(ACCOUNT_COLLECTION).doc(uid).get();
  if (!doc.exists) return null;
  return doc.data() as SubscriptionRecord;
}

/** Grant/update an account-level entitlement for a user. */
export async function upsertAccountEntitlement(
  uid: string,
  data: Partial<SubscriptionRecord>,
): Promise<void> {
  await adminDb
    .collection(ACCOUNT_COLLECTION)
    .doc(uid)
    .set({ ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

/** Revoke an account-level entitlement. */
export async function deleteAccountEntitlement(uid: string): Promise<void> {
  await adminDb.collection(ACCOUNT_COLLECTION).doc(uid).delete();
}

export async function upsertSubscriptionForWorkspace(
  workspaceId: string,
  data: Partial<SubscriptionRecord>,
): Promise<void> {
  await adminDb
    .collection(COLLECTION)
    .doc(workspaceId)
    .set({ ...data, workspaceId, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function deleteSubscriptionForWorkspace(workspaceId: string): Promise<void> {
  await adminDb.collection(COLLECTION).doc(workspaceId).delete();
}

/**
 * Look up a workspaceId from a Stripe customer id.
 * Prefers subscription documents (primary key match); falls back to any
 * legacy uid-keyed record that still carries the customer id.
 */
export async function findWorkspaceIdByCustomerId(customerId: string): Promise<string | null> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where('stripeCustomerId', '==', customerId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data() as { workspaceId?: string };
  // If this is a freshly written workspace-keyed doc, its id IS the workspaceId.
  // If this is a legacy uid-keyed doc, the `workspaceId` field is absent
  // and the caller is expected to either migrate or resolve from the
  // user's personal workspace.
  return data.workspaceId || null;
}

/** Back-compat: some callers hand us a uid but really want the customer mapping. */
export async function findUidByCustomerId(customerId: string): Promise<string | null> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where('stripeCustomerId', '==', customerId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

/**
 * Resolve the subscription in effect for a workspace. During the migration
 * window this also checks legacy uid-keyed docs for any workspace member
 * so in-flight users don't lose their plan.
 */
export async function getEffectiveSubscription(
  opts: { uid?: string; workspaceId?: string } | string,
  legacyWorkspaceId?: string,
): Promise<SubscriptionRecord | null> {
  // Support both the new object form and the legacy
  // `getEffectiveSubscription(uid, workspaceId)` positional form.
  const uid = typeof opts === 'string' ? opts : opts.uid;
  const workspaceId =
    typeof opts === 'string' ? legacyWorkspaceId : opts.workspaceId;

  // Account-level entitlement (manual comps / per-user plans) is granted to the
  // user, not a workspace, so an active one takes precedence and applies no
  // matter which workspace the request is scoped to.
  const account = uid ? await getAccountEntitlement(uid) : null;
  if (account && ACTIVE_STATUSES.has(account.status)) return account;

  if (workspaceId) {
    const primary = await getSubscriptionForWorkspace(workspaceId);
    if (primary) return primary;

    // Legacy fallback: any member of the workspace had a uid-keyed sub.
    const membersSnap = await adminDb.collection(`workspaces/${workspaceId}/members`).get();
    const candidates: SubscriptionRecord[] = [];
    for (const member of membersSnap.docs) {
      const legacy = await adminDb.collection(COLLECTION).doc(member.id).get();
      if (legacy.exists) candidates.push(legacy.data() as SubscriptionRecord);
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const priority = (s: SubscriptionRecord) => (ACTIVE_STATUSES.has(s.status) ? 2 : s.status === 'past_due' ? 1 : 0);
        const diff = priority(b) - priority(a);
        if (diff !== 0) return diff;
        return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      });
      return candidates[0];
    }
  }

  // Nothing active at the workspace level — surface any (possibly inactive)
  // account record so billing history / past comps still resolve.
  return account;
}

/** @deprecated use getSubscriptionForWorkspace */
export async function getSubscription(uid: string): Promise<SubscriptionRecord | null> {
  const doc = await adminDb.collection(COLLECTION).doc(uid).get();
  if (!doc.exists) return null;
  return doc.data() as SubscriptionRecord;
}

/** @deprecated use upsertSubscriptionForWorkspace */
export async function upsertSubscription(uid: string, data: Partial<SubscriptionRecord>): Promise<void> {
  await adminDb.collection(COLLECTION).doc(uid).set(
    { ...data, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

export async function getWorkspaceSubscription(workspaceId: string): Promise<SubscriptionRecord | null> {
  return getEffectiveSubscription({ workspaceId });
}

export type SubscriptionStatus = {
  active: boolean;
  hasSubscriptionHistory: boolean;
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
      hasSubscriptionHistory: false,
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
    hasSubscriptionHistory: true,
    tier: (sub.tier as PlanTier) || null,
    interval: sub.interval || null,
    trialing: sub.status === 'trialing',
    trialEnd: sub.trialEnd || null,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd || false,
    currentPeriodEnd: sub.currentPeriodEnd || null,
  };
}
