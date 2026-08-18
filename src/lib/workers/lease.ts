import crypto from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

function expiryMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  if (value && typeof value === 'object' && 'toMillis' in value) {
    return Number((value as { toMillis: () => number }).toMillis());
  }
  return 0;
}

export async function acquireWorkerLease(name: string, ttlMs: number): Promise<string | null> {
  const ref = adminDb.doc(`_workerLeases/${name}`);
  const leaseId = crypto.randomUUID();
  const now = Date.now();

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && expiryMillis(snap.data()?.expiresAt) > now) return null;
    tx.set(ref, {
      leaseId,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: Timestamp.fromMillis(now + ttlMs),
    });
    return leaseId;
  });
}

export async function releaseWorkerLease(name: string, leaseId: string): Promise<void> {
  const ref = adminDb.doc(`_workerLeases/${name}`);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.leaseId !== leaseId) return;
    tx.delete(ref);
  });
}
