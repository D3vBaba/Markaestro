import { adminDb } from '@/lib/firebase-admin';
import type { SubscriptionRecord } from './server';
import { PLANS, type PlanTier } from './plans';

/**
 * Subscriptions are keyed by workspaceId. The Stripe customer + subscription
 * live on the workspace, not on a single Firebase user, so that ownership
 * transfers and multi-owner teams don't lose billing state.
 *
 * Legacy uid-keyed data (`subscriptions/{uid}`) was migrated by
 * `scripts/backfill-workspace-subscriptions.mjs`; the resolver no longer
 * consults uid-keyed docs.
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

/**
 * Older subscriptions were keyed by Firebase uid and had no workspaceId.
 * They belong only to the personal workspace created by that same user; they
 * must never grant paid access inside an unrelated team workspace.
 */
export function legacySubscriptionAppliesToWorkspace(
  legacy: SubscriptionRecord | null,
  uid: string,
  workspaceId: string,
  workspaceCreatedBy: unknown,
): legacy is SubscriptionRecord {
  if (!legacy || workspaceCreatedBy !== uid) return false;
  return !legacy.workspaceId || legacy.workspaceId === workspaceId;
}

async function getLegacySubscriptionForOwnedWorkspace(
  uid: string,
  workspaceId: string,
): Promise<SubscriptionRecord | null> {
  const [legacySnap, workspaceSnap] = await adminDb.getAll(
    adminDb.collection(COLLECTION).doc(uid),
    adminDb.collection('workspaces').doc(workspaceId),
  );
  if (!legacySnap.exists || !workspaceSnap.exists) return null;

  const legacy = legacySnap.data() as SubscriptionRecord;
  return legacySubscriptionAppliesToWorkspace(
    legacy,
    uid,
    workspaceId,
    workspaceSnap.data()?.createdBy,
  )
    ? legacy
    : null;
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

/** True when the record grants entitlements right now (active or trialing). */
export function isActiveSubscription(sub: SubscriptionRecord | null | undefined): sub is SubscriptionRecord {
  return Boolean(sub && ACTIVE_STATUSES.has(sub.status));
}

function tierRank(tier: string | undefined): number {
  if (tier === 'business') return 3;
  if (tier === 'pro') return 2;
  if (tier === 'starter') return 1;
  // 'free' and any unrecognized tier (e.g. 'unknown' from an unmapped
  // Stripe price) rank lowest.
  return 0;
}

/**
 * The plan tier a record actually entitles its holder to. Inactive records
 * (canceled, past_due, incomplete, …), unrecognized tiers, and missing
 * records all resolve to 'free' — the not-purchasable tier every workspace
 * without an active subscription lives on.
 */
export function effectiveTier(sub: SubscriptionRecord | null | undefined): PlanTier {
  if (!isActiveSubscription(sub)) return 'free';
  const tier = sub.tier as PlanTier;
  return PLANS[tier] && tier !== 'free' ? tier : 'free';
}

/**
 * Merge an account-level entitlement with a workspace subscription.
 *
 * Entitlements are additive: among ACTIVE records the higher tier wins
 * (workspace wins ties), so a personal comp can never downgrade a member
 * inside a premium workspace, and a comped user keeps their plan in their
 * own free workspace. With nothing active, the workspace record (then the
 * account record) is surfaced so billing history and status still resolve —
 * callers must gate entitlements via `effectiveTier`/`isActiveSubscription`,
 * never by reading `tier` directly.
 *
 * Pure — exported for tests.
 */
export function pickEffectiveSubscription(
  account: SubscriptionRecord | null,
  workspace: SubscriptionRecord | null,
): SubscriptionRecord | null {
  const activeAccount = isActiveSubscription(account) ? account : null;
  const activeWorkspace = isActiveSubscription(workspace) ? workspace : null;

  if (activeAccount && activeWorkspace) {
    return tierRank(activeAccount.tier) > tierRank(activeWorkspace.tier)
      ? activeAccount
      : activeWorkspace;
  }
  if (activeWorkspace) return activeWorkspace;
  if (activeAccount) return activeAccount;
  return workspace ?? account;
}

/**
 * Resolve the subscription in effect for a user acting inside a workspace:
 * the workspace's own subscription merged with the user's account-level
 * entitlement (higher active tier wins).
 */
export async function getEffectiveSubscription(
  opts: { uid?: string; workspaceId?: string } | string,
  legacyWorkspaceId?: string,
): Promise<SubscriptionRecord | null> {
  // Support both the object form and the positional
  // `getEffectiveSubscription(uid, workspaceId)` form.
  const uid = typeof opts === 'string' ? opts : opts.uid;
  const workspaceId =
    typeof opts === 'string' ? legacyWorkspaceId : opts.workspaceId;

  const [account, workspaceSubscription] = await Promise.all([
    uid ? getAccountEntitlement(uid) : Promise.resolve(null),
    workspaceId ? getSubscriptionForWorkspace(workspaceId) : Promise.resolve(null),
  ]);

  // Most workspaces use workspace-keyed subscription records. A small number
  // of paid accounts predate that migration; if their record was missed, use
  // it only for the workspace they own instead of silently treating them as
  // unsubscribed.
  const legacySubscription =
    !workspaceSubscription && uid && workspaceId
      ? await getLegacySubscriptionForOwnedWorkspace(uid, workspaceId)
      : null;

  return pickEffectiveSubscription(account, workspaceSubscription ?? legacySubscription);
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
