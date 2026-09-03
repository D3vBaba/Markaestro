import { adminDb } from '@/lib/firebase-admin';
import type { PlatformOperationKind, PlatformOperationState } from './types';

export type PlatformOperation = {
  id: string;
  workspaceId: string;
  postId: string;
  channel: string;
  kind: PlatformOperationKind;
  providerOperationId: string;
  state: PlatformOperationState;
  attemptCount: number;
  nextPollAt: string | null;
  expiresAt: string | null;
  checkpoint: Record<string, unknown>;
  lastErrorCode: string | null;
  leaseId: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function operationRef(workspaceId: string, postId: string, operationId: string) {
  return adminDb.doc(`workspaces/${workspaceId}/posts/${postId}/platformOperations/${operationId}`);
}

export async function createPlatformOperation(input: {
  workspaceId: string;
  postId: string;
  channel: string;
  kind: PlatformOperationKind;
  providerOperationId: string;
  nextPollAt?: string;
  expiresAt?: string;
  checkpoint?: Record<string, unknown>;
}) {
  const id = `${input.channel}_${input.kind}_${input.providerOperationId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const now = new Date().toISOString();
  const doc: Omit<PlatformOperation, 'id'> = {
    ...input,
    state: 'pending',
    attemptCount: 0,
    nextPollAt: input.nextPollAt ?? now,
    expiresAt: input.expiresAt ?? null,
    checkpoint: input.checkpoint ?? {},
    lastErrorCode: null,
    leaseId: null,
    leaseExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await operationRef(input.workspaceId, input.postId, id).set(doc, { merge: false });
  return { id, ...doc };
}

export async function claimPlatformOperation(
  workspaceId: string,
  postId: string,
  operationId: string,
  leaseMs = 5 * 60_000,
): Promise<PlatformOperation | null> {
  const ref = operationRef(workspaceId, postId, operationId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const operation = { id: snap.id, ...snap.data() } as PlatformOperation;
    if (!['pending', 'retrying', 'processing'].includes(operation.state)) return null;
    if (operation.expiresAt && Date.parse(operation.expiresAt) <= Date.now()) {
      tx.update(ref, { state: 'expired', updatedAt: new Date().toISOString() });
      return null;
    }
    if (operation.leaseExpiresAt && Date.parse(operation.leaseExpiresAt) > Date.now()) return null;
    const leaseId = crypto.randomUUID();
    const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
    tx.update(ref, {
      state: 'processing',
      leaseId,
      leaseExpiresAt,
      attemptCount: operation.attemptCount + 1,
      updatedAt: new Date().toISOString(),
    });
    return { ...operation, state: 'processing', leaseId, leaseExpiresAt, attemptCount: operation.attemptCount + 1 };
  });
}

export async function settlePlatformOperation(input: {
  workspaceId: string;
  postId: string;
  operationId: string;
  leaseId: string;
  state: 'succeeded' | 'retrying' | 'failed';
  nextPollAt?: string;
  checkpoint?: Record<string, unknown>;
  errorCode?: string;
}) {
  const ref = operationRef(input.workspaceId, input.postId, input.operationId);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.leaseId !== input.leaseId) return;
    tx.update(ref, {
      state: input.state,
      nextPollAt: input.nextPollAt ?? null,
      checkpoint: input.checkpoint ?? snap.data()?.checkpoint ?? {},
      lastErrorCode: input.errorCode ?? null,
      leaseId: null,
      leaseExpiresAt: null,
      updatedAt: new Date().toISOString(),
    });
  });
}
