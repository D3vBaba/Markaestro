import { adminDb } from '@/lib/firebase-admin';
import { pickLocaleFromAcceptLanguage } from '@/i18n/routing';

/**
 * Pending invites live at workspaces/{ws}/pendingInvites/{email} (email is
 * normalized lowercase). Joining is an explicit, user-initiated step:
 * the app lists invites addressed to the signed-in email and the user
 * accepts or declines each one. Nothing joins a workspace as a side effect
 * of authentication.
 */

export type PendingInviteSummary = {
  workspaceId: string;
  workspaceName: string;
  role: string;
  invitedByEmail: string;
  invitedAt: string | null;
};

type InviteDocData = {
  email?: string;
  role?: string;
  invitedBy?: string;
  invitedByEmail?: string;
  invitedAt?: string;
  expiresAt?: { toDate?: () => Date } | string | null;
};

/** Millisecond expiry from either a Firestore Timestamp or an ISO string. Pure, exported for tests. */
export function inviteExpiryMs(expiresAt: InviteDocData['expiresAt']): number | null {
  if (!expiresAt) return null;
  if (typeof expiresAt === 'string') {
    const ms = new Date(expiresAt).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const date = expiresAt.toDate?.();
  return date ? date.getTime() : null;
}

export function isInviteExpired(expiresAt: InviteDocData['expiresAt'], nowMs = Date.now()): boolean {
  const ms = inviteExpiryMs(expiresAt);
  return ms !== null && ms < nowMs;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * All unexpired invites addressed to an email, with workspace names resolved.
 * Expired invites encountered along the way are deleted (the TTL policy is
 * eventually consistent, so enforce at read time too).
 */
export async function listPendingInvitesForEmail(email: string): Promise<PendingInviteSummary[]> {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];

  const snap = await adminDb
    .collectionGroup('pendingInvites')
    .where('email', '==', normalized)
    .get();

  const invites: Array<{ workspaceId: string; data: InviteDocData }> = [];
  const expired: FirebaseFirestore.DocumentReference[] = [];

  for (const doc of snap.docs) {
    const workspaceId = doc.ref.path.split('/')[1];
    if (!workspaceId) continue;
    const data = doc.data() as InviteDocData;
    if (isInviteExpired(data.expiresAt)) {
      expired.push(doc.ref);
      continue;
    }
    invites.push({ workspaceId, data });
  }

  if (expired.length > 0) {
    const batch = adminDb.batch();
    for (const ref of expired) batch.delete(ref);
    await batch.commit();
  }

  return Promise.all(
    invites.map(async ({ workspaceId, data }) => {
      const wsSnap = await adminDb.doc(`workspaces/${workspaceId}`).get();
      return {
        workspaceId,
        workspaceName: (wsSnap.data()?.name as string) || workspaceId,
        role: data.role || 'member',
        invitedByEmail: data.invitedByEmail || '',
        invitedAt: data.invitedAt || null,
      };
    }),
  );
}

/** Number of unexpired invites addressed to an email. */
export async function countPendingInvitesForEmail(email: string): Promise<number> {
  const normalized = normalizeEmail(email);
  if (!normalized) return 0;
  const snap = await adminDb
    .collectionGroup('pendingInvites')
    .where('email', '==', normalized)
    .get();
  return snap.docs.filter((doc) => !isInviteExpired((doc.data() as InviteDocData).expiresAt)).length;
}

/**
 * Accept an invite: create the member doc and consume the invite atomically.
 * Throws NOT_FOUND when no live invite exists for this email + workspace.
 */
export async function acceptPendingInvite(opts: {
  uid: string;
  email: string;
  workspaceId: string;
  acceptLanguage?: string | null;
}): Promise<{ workspaceId: string; workspaceName: string; role: string }> {
  const { uid, workspaceId, acceptLanguage } = opts;
  const normalized = normalizeEmail(opts.email);
  if (!normalized) throw new Error('NOT_FOUND');

  const inviteRef = adminDb.doc(`workspaces/${workspaceId}/pendingInvites/${normalized}`);
  const memberRef = adminDb.doc(`workspaces/${workspaceId}/members/${uid}`);
  const wsRef = adminDb.doc(`workspaces/${workspaceId}`);
  const now = new Date().toISOString();

  const role = await adminDb.runTransaction(async (tx) => {
    const [inviteSnap, memberSnap] = await Promise.all([tx.get(inviteRef), tx.get(memberRef)]);
    if (!inviteSnap.exists) throw new Error('NOT_FOUND');

    const data = inviteSnap.data() as InviteDocData;
    if (isInviteExpired(data.expiresAt)) {
      // Consume the stale doc and report the invite as gone.
      tx.delete(inviteRef);
      return null;
    }

    const invitedRole = data.role || 'member';
    if (!memberSnap.exists) {
      tx.set(memberRef, {
        uid,
        email: normalized,
        role: invitedRole,
        joinedAt: now,
        locale: pickLocaleFromAcceptLanguage(acceptLanguage),
      });
    }
    tx.delete(inviteRef);
    return memberSnap.exists ? ((memberSnap.data()?.role as string) || 'member') : invitedRole;
  });

  if (role === null) throw new Error('NOT_FOUND');

  const wsSnap = await wsRef.get();
  return {
    workspaceId,
    workspaceName: (wsSnap.data()?.name as string) || workspaceId,
    role,
  };
}

/** Decline (or revoke) an invite. Idempotent — deleting a missing invite is a no-op. */
export async function deletePendingInvite(workspaceId: string, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  await adminDb.doc(`workspaces/${workspaceId}/pendingInvites/${normalized}`).delete();
}
