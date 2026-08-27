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
