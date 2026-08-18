import { adminDb } from '@/lib/firebase-admin';
import { getEffectiveSubscription, effectiveTier } from '@/lib/stripe/subscription';
import { PLANS } from '@/lib/stripe/plans';
import type { PlanLimits } from '@/lib/stripe/plans';

export type UsageType = 'posts';

const LIMIT_KEY: Record<UsageType, keyof PlanLimits> = {
  posts: 'postsPerMonth',
};

export type UsageCheckResult = {
  allowed: boolean;
  current: number;
  limit: number;
  reason?: 'subscription_required' | 'quota_exceeded';
};

export type StorageReserveResult = {
  allowed: boolean;
  /** Cumulative bytes stored after (allowed) or at the time of (refused) the reservation. */
  currentBytes: number;
  /** Plan cap in bytes; -1 = unlimited. */
  limitBytes: number;
  reason?: 'quota_exceeded';
};

export const BYTES_PER_GB = 1024 ** 3;

/** A plan's storage cap in bytes; -1 = unlimited. */
export function storageLimitBytes(limits: Pick<PlanLimits, 'storageGb'>): number {
  return limits.storageGb === -1 ? -1 : limits.storageGb * BYTES_PER_GB;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // e.g. "2026-03"
}

function usageScopeId(uid: string, workspaceId?: string): string {
  return workspaceId ? `workspace:${workspaceId}` : `user:${uid}`;
}

function storageDocRef(workspaceId: string) {
  // Storage is always workspace-scoped: media belongs to the workspace, so
  // there is no user-scoped fallback like the monthly counters have.
  return adminDb.collection('usage').doc(usageScopeId('', workspaceId));
}

/**
 * Cumulative baseline for usage docs that predate storage metering, summed
 * from the workspace's media docs. Only public-API/Connect uploads write
 * `media_assets` docs (with `sizeBytes`); in-app uploads made before metering
 * left no media doc and are grandfathered in at zero.
 */
async function legacyStorageBytesBaseline(workspaceId: string): Promise<number> {
  const { AggregateField } = await import('firebase-admin/firestore');
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/media_assets`)
    .aggregate({ storageBytes: AggregateField.sum('sizeBytes') })
    .get();
  return Math.max(0, Number(snap.data().storageBytes) || 0);
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

/**
 * Reserve cumulative storage for an upload. Unlike the monthly counters,
 * `storageBytes` never resets — deletions and failed uploads release it via
 * `refundStorage`. Callers resolve `limits` themselves (they usually already
 * have them) so this stays a single transactional Firestore round trip.
 *
 * Usage docs that predate storage metering are initialized lazily: the
 * aggregate baseline is read before the transaction and applied only if the
 * field is still missing inside it.
 */
export async function reserveStorage(
  workspaceId: string,
  bytes: number,
  limits: Pick<PlanLimits, 'storageGb'>,
): Promise<StorageReserveResult> {
  const size = Math.max(0, Math.floor(bytes) || 0);
  const limitBytes = storageLimitBytes(limits);
  const docRef = storageDocRef(workspaceId);

  const preSnap = await docRef.get();
  const baseline = typeof preSnap.data()?.storageBytes === 'number'
    ? null
    : await legacyStorageBytesBaseline(workspaceId);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const stored = snap.data()?.storageBytes;
    const current = typeof stored === 'number' ? Math.max(0, stored) : (baseline ?? 0);

    if (limitBytes !== -1 && current + size > limitBytes) {
      // Persist the lazily computed baseline even when refusing so the next
      // check (and the usage endpoint) don't re-run the aggregate.
      if (typeof stored !== 'number') tx.set(docRef, { storageBytes: current }, { merge: true });
      return { allowed: false, currentBytes: current, limitBytes, reason: 'quota_exceeded' as const };
    }

    // Unlimited plans still record usage so the usage endpoint can report it
    // and a later downgrade meters against the true footprint.
    tx.set(docRef, { storageBytes: current + size }, { merge: true });
    return { allowed: true, currentBytes: current + size, limitBytes };
  });
}

/**
 * Release reserved bytes — failed uploads and media deletions alike. Runs in
 * a transaction so a refund racing a reservation can never drive the counter
 * negative. Legacy media docs without a recorded size should refund 0.
 */
export async function refundStorage(workspaceId: string, bytes: number): Promise<void> {
  const size = Math.floor(bytes) || 0;
  if (size <= 0) return;
  const docRef = storageDocRef(workspaceId);

  const preSnap = await docRef.get();
  const baseline = typeof preSnap.data()?.storageBytes === 'number'
    ? null
    : await legacyStorageBytesBaseline(workspaceId);

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const stored = snap.data()?.storageBytes;
    // A missing field means a legacy workspace deleting media before its
    // first metered upload: initialize from the aggregate instead of
    // decrementing — refunds run after the media doc is deleted, so the
    // aggregate already excludes it.
    const next = typeof stored === 'number'
      ? Math.max(0, stored - size)
      : Math.max(0, baseline ?? 0);
    tx.set(docRef, { storageBytes: next }, { merge: true });
  });
}

export async function getUsage(
  uid: string,
  workspaceId?: string,
): Promise<{ posts: number; storageBytes: number }> {
  const month = currentMonth();
  const docRef = adminDb.collection('usage').doc(usageScopeId(uid, workspaceId));
  const snap = await docRef.get();
  const data = snap.data() ?? {};

  let storageBytes = typeof data.storageBytes === 'number' ? Math.max(0, data.storageBytes) : null;
  if (storageBytes === null) {
    // Legacy doc: surface the aggregate baseline and persist it (only if
    // still missing — a concurrent reservation must win) so neither the
    // reserve path nor the next read recomputes it.
    storageBytes = workspaceId ? await legacyStorageBytesBaseline(workspaceId) : 0;
    const initial = storageBytes;
    await adminDb.runTransaction(async (tx) => {
      const fresh = await tx.get(docRef);
      if (typeof fresh.data()?.storageBytes !== 'number') {
        tx.set(docRef, { storageBytes: initial }, { merge: true });
      }
    }).catch(() => undefined); // non-fatal
  }

  return {
    posts: (data[`${month}_posts`] as number) ?? 0,
    storageBytes,
  };
}
