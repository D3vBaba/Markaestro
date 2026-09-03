import { randomUUID } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';

export type InboxItemType = 'experiment_complete' | 'system';

export type InboxItem = {
  id: string;
  workspaceId: string;
  uid: string;
  type: InboxItemType;
  title: string;
  body: string;
  href?: string;
  experimentId?: string | null;
  meta?: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export async function createInboxItem(input: {
  id?: string;
  workspaceId: string;
  uid: string;
  type: InboxItemType;
  title: string;
  body: string;
  href?: string;
  meta?: Record<string, unknown>;
}): Promise<InboxItem> {
  const id = input.id ?? randomUUID();
  const createdAt = new Date().toISOString();
  const experimentId = typeof input.meta?.experimentId === 'string' ? input.meta.experimentId : null;
  const item: InboxItem = {
    id,
    workspaceId: input.workspaceId,
    uid: input.uid,
    type: input.type,
    title: input.title,
    body: input.body,
    href: input.href,
    experimentId,
    meta: input.meta,
    readAt: null,
    createdAt,
  };
  const ref = adminDb.doc(`workspaces/${input.workspaceId}/inbox/${id}`);
  if (input.id) {
    try {
      await ref.create(item);
    } catch (error) {
      const code = (error as { code?: string | number } | null)?.code;
      if (code !== 6 && code !== 'already-exists') throw error;
    }
  } else {
    await ref.set(item);
  }
  return item;
}

export async function listInboxItems(workspaceId: string, uid: string, limit = 30): Promise<InboxItem[]> {
  try {
    const snapshot = await adminDb.collection(`workspaces/${workspaceId}/inbox`)
      .where('uid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<InboxItem, 'id'>) }));
  } catch {
    const all = await adminDb.collection(`workspaces/${workspaceId}/inbox`)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    return all.docs
      .filter((doc) => doc.data()?.uid === uid)
      .slice(0, limit)
      .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<InboxItem, 'id'>) }));
  }
}

export async function markInboxRead(workspaceId: string, id: string, uid: string) {
  const ref = adminDb.doc(`workspaces/${workspaceId}/inbox/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('NOT_FOUND');
  if (snap.data()?.uid !== uid) throw new Error('FORBIDDEN');
  await ref.set({ readAt: new Date().toISOString() }, { merge: true });
}
