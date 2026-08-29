import { adminDb } from '@/lib/firebase-admin';

export async function consumeAiOperation(input: {
  workspaceId: string;
  uid: string;
  monthlyLimit: number;
  now?: Date;
}): Promise<number> {
  const now = input.now || new Date();
  const month = now.toISOString().slice(0, 7);
  const ref = adminDb.doc(`workspaces/${input.workspaceId}/aiUsageDaily/${month}`);
  return adminDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const count = Number(snapshot.data()?.aiOperations) || 0;
    if (input.monthlyLimit >= 0 && count >= input.monthlyLimit) throw new Error('QUOTA_EXCEEDED');
    const next = count + 1;
    tx.set(ref, {
      month,
      aiOperations: next,
      updatedAt: now.toISOString(),
      lastUsedBy: input.uid,
    }, { merge: true });
    return next;
  });
}

/** Give back an AI operation when the model call failed after the charge. */
export async function refundAiOperation(input: {
  workspaceId: string;
  now?: Date;
}): Promise<void> {
  const now = input.now || new Date();
  const month = now.toISOString().slice(0, 7);
  const ref = adminDb.doc(`workspaces/${input.workspaceId}/aiUsageDaily/${month}`);
  await adminDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const count = Number(snapshot.data()?.aiOperations) || 0;
    tx.set(ref, { month, aiOperations: Math.max(0, count - 1), updatedAt: now.toISOString() }, { merge: true });
  });
}

export async function consumeStrategistTurn(input: {
  workspaceId: string;
  uid: string;
  monthlyLimit: number;
  now?: Date;
}): Promise<number> {
  const now = input.now || new Date();
  const month = now.toISOString().slice(0, 7);
  const ref = adminDb.doc(`workspaces/${input.workspaceId}/aiUsageDaily/${month}`);
  return adminDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const count = Number(snapshot.data()?.strategistTurns) || 0;
    if (input.monthlyLimit >= 0 && count >= input.monthlyLimit) throw new Error('QUOTA_EXCEEDED');
    const next = count + 1;
    tx.set(ref, { month, strategistTurns: next, updatedAt: now.toISOString(), lastUsedBy: input.uid }, { merge: true });
    return next;
  });
}

/** Give back a strategist turn when the model call failed after the charge. */
export async function refundStrategistTurn(input: {
  workspaceId: string;
  now?: Date;
}): Promise<void> {
  const now = input.now || new Date();
  const month = now.toISOString().slice(0, 7);
  const ref = adminDb.doc(`workspaces/${input.workspaceId}/aiUsageDaily/${month}`);
  await adminDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const count = Number(snapshot.data()?.strategistTurns) || 0;
    tx.set(ref, { month, strategistTurns: Math.max(0, count - 1), updatedAt: now.toISOString() }, { merge: true });
  });
}

export type AiOperationKind = 'operation' | 'strategist';

export type AiOperationInput = {
  workspaceId: string;
  uid: string;
  monthlyLimit: number;
  kind?: AiOperationKind;
  now?: Date;
};

/**
 * Charge an AI operation, run the work, and give the charge back if the work
 * throws.
 *
 * Five call sites hand-rolled the charge and only two of them hand-rolled the
 * refund, so a Vertex 503 on `/strategist` silently cost the customer a turn
 * they never got an answer for. Owning both halves in one place is the only
 * way that stays true as call sites are added.
 *
 * The quota rejection itself is never refunded: `consume` throws
 * QUOTA_EXCEEDED before incrementing anything, so there is nothing to give
 * back, and a refund there would hand out a free operation per rejected call.
 *
 * The refund is best-effort by design. If it fails, the user is short one
 * operation, which is bad; failing the request a second time and hiding the
 * original error would be worse.
 */
export async function withAiOperation<T>(
  input: AiOperationInput,
  run: () => Promise<T>,
): Promise<T> {
  const kind = input.kind || 'operation';
  const consume = kind === 'strategist' ? consumeStrategistTurn : consumeAiOperation;
  await consume(input);

  try {
    return await run();
  } catch (error) {
    const refund = kind === 'strategist' ? refundStrategistTurn : refundAiOperation;
    await refund({ workspaceId: input.workspaceId, now: input.now }).catch(() => undefined);
    throw error;
  }
}
