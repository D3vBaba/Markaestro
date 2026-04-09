import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { createHash } from 'node:crypto';
import { DEFAULT_WORKSPACE_ID, getWorkspaceId, isValidWorkspaceId } from '@/lib/workspace';
import { verifySessionCookieAsync } from '@/lib/session-cookie';
import type { WorkspaceRole } from '@/lib/schemas';

export type RequestContext = {
  uid: string;
  email?: string;
  workspaceId: string;
  role: WorkspaceRole;
};

function normalizeEmail(email?: string | null): string | null {
  const value = email?.trim().toLowerCase();
  return value || null;
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') || '';
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function getSessionCookie(req: Request): string | null {
  const cookieHeader = req.headers.get('cookie') || '';
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name === '__session') {
      const value = valueParts.join('=').trim();
      return value || null;
    }
  }

  return null;
}

function getUidFromSessionCookie(cookie: string): string | null {
  const [uid] = cookie.split('.');
  return uid || null;
}

function personalWorkspaceId(uid: string): string {
  const hash = createHash('sha256').update(uid).digest('hex').slice(0, 24);
  return `ws-${hash}`;
}

async function getWorkspaceMembership(
  uid: string,
  workspaceId: string,
): Promise<{ workspaceId: string; role: RequestContext['role'] } | null> {
  const memberRef = adminDb.doc(`workspaces/${workspaceId}/members/${uid}`);
  const memberSnap = await memberRef.get();

  if (!memberSnap.exists) {
    return null;
  }

  const role = (memberSnap.data()?.role || 'member') as RequestContext['role'];
  return { workspaceId, role };
}

async function bootstrapPersonalWorkspace(uid: string, email?: string): Promise<RequestContext> {
  const workspaceId = personalWorkspaceId(uid);
  const now = new Date().toISOString();
  const wsRef = adminDb.doc(`workspaces/${workspaceId}`);
  const memberRef = adminDb.doc(`workspaces/${workspaceId}/members/${uid}`);

  await adminDb.runTransaction(async (tx) => {
    const [wsSnap, memberSnap] = await Promise.all([tx.get(wsRef), tx.get(memberRef)]);

    if (!wsSnap.exists) {
      tx.set(wsRef, {
        name: 'My Workspace',
        slug: workspaceId,
        createdAt: now,
        createdBy: uid,
      });
    }

    if (!memberSnap.exists) {
      tx.set(memberRef, {
        uid,
        email: email || '',
        role: 'owner',
        joinedAt: now,
      });
    }
  });

  return { uid, email, workspaceId, role: 'owner' };
}

async function findUserMembership(uid: string): Promise<{ workspaceId: string; role: RequestContext['role'] } | null> {
  const snap = await adminDb
    .collectionGroup('members')
    .where('uid', '==', uid)
    .limit(1)
    .get();

  if (snap.empty) {
    return null;
  }

  const doc = snap.docs[0];
  const parts = doc.ref.path.split('/');
  const workspaceId = parts[1];
  const role = (doc.data().role || 'member') as RequestContext['role'];
  return { workspaceId, role };
}

async function acceptPendingInvites(uid: string, email?: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;

  const candidates = Array.from(new Set([email, normalizedEmail].filter(Boolean) as string[]));
  const inviteSnaps = await Promise.all(
    candidates.map((candidate) => adminDb.collectionGroup('pendingInvites').where('email', '==', candidate).get()),
  );

  const inviteDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const snap of inviteSnaps) {
    for (const doc of snap.docs) {
      inviteDocs.set(doc.ref.path, doc);
    }
  }

  if (inviteDocs.size === 0) return;

  const now = new Date().toISOString();
  const batch = adminDb.batch();

  for (const inviteDoc of inviteDocs.values()) {
    const parts = inviteDoc.ref.path.split('/');
    const workspaceId = parts[1];
    if (!workspaceId) continue;

    const memberRef = adminDb.doc(`workspaces/${workspaceId}/members/${uid}`);
    const memberSnap = await memberRef.get();

    if (!memberSnap.exists) {
      batch.set(memberRef, {
        uid,
        email: normalizedEmail,
        role: inviteDoc.data().role || 'member',
        joinedAt: now,
      }, { merge: true });
    }

    batch.delete(inviteDoc.ref);
  }

  await batch.commit();
}

export async function requireContext(req: Request): Promise<RequestContext> {
  const token = getBearerToken(req);
  const sessionCookie = getSessionCookie(req);

  let uid: string;
  let email: string | undefined;

  if (token) {
    let decoded: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>;
    try {
      decoded = await adminAuth.verifyIdToken(token);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (
        message.includes('id token') ||
        message.includes('jwt') ||
        message.includes('token') ||
        message.includes('credential')
      ) {
        throw new Error('UNAUTHENTICATED');
      }
      throw error;
    }

    uid = decoded.uid;
    email = normalizeEmail(decoded.email) || undefined;
  } else if (sessionCookie && await verifySessionCookieAsync(sessionCookie)) {
    const sessionUid = getUidFromSessionCookie(sessionCookie);
    if (!sessionUid) {
      throw new Error('UNAUTHENTICATED');
    }

    uid = sessionUid;
    try {
      const userRecord = await adminAuth.getUser(uid);
      email = normalizeEmail(userRecord.email) || undefined;
    } catch {
      throw new Error('UNAUTHENTICATED');
    }
  } else {
    throw new Error('UNAUTHENTICATED');
  }

  try {
    await acceptPendingInvites(uid, email);
  } catch (err) {
    // Non-fatal — pending invite resolution should not block auth. Typically
    // caused by a missing Firestore collection-group index on pendingInvites.email.
    console.warn('[requireContext] acceptPendingInvites failed (non-fatal):', err);
  }

  const url = new URL(req.url);
  const requestedWs = getWorkspaceId(
    url.searchParams.get('workspaceId') || req.headers.get('x-workspace-id'),
  );

  if (!isValidWorkspaceId(requestedWs)) {
    throw new Error('VALIDATION_INVALID_WORKSPACE_ID');
  }

  const requestedMembership = await getWorkspaceMembership(uid, requestedWs);
  if (requestedMembership) {
    return { uid, email, workspaceId: requestedMembership.workspaceId, role: requestedMembership.role };
  }

  if (requestedWs !== DEFAULT_WORKSPACE_ID) {
    if (!requestedMembership) {
      throw new Error('FORBIDDEN_WORKSPACE');
    }
  }

  const membership = await findUserMembership(uid);
  if (membership) {
    return { uid, email, workspaceId: membership.workspaceId, role: membership.role };
  }

  return bootstrapPersonalWorkspace(uid, email);
}
