import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { createHash } from 'node:crypto';
import { DEFAULT_WORKSPACE_ID, getWorkspaceId, isValidWorkspaceId } from '@/lib/workspace';
import { decodeSessionCookie } from '@/lib/session-cookie';
import { parseBearerToken } from '@/lib/bearer';
import type { WorkspaceRole } from '@/lib/schemas';

export type RequestContext = {
  uid: string;
  email?: string;
  workspaceId: string;
  role: WorkspaceRole;
  /**
   * Whether the user's email address is verified (from the decoded ID token's
   * `email_verified` claim, or the Auth user record on the session-cookie path).
   * Unverified users keep read/draft access; routes that push content outbound
   * (publish, schedule) must check this and reject with EMAIL_NOT_VERIFIED.
   */
  emailVerified: boolean;
};

function normalizeEmail(email?: string | null): string | null {
  const value = email?.trim().toLowerCase();
  return value || null;
}

function getBearerToken(req: Request): string | null {
  return parseBearerToken(req.headers.get('authorization'));
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

type ResolvedWorkspaceContext = Omit<RequestContext, 'emailVerified'>;

async function bootstrapPersonalWorkspace(uid: string, email?: string): Promise<ResolvedWorkspaceContext> {
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

    const data = inviteDoc.data();
    // Skip expired invites (TTL cleanup is eventually consistent; enforce at read time).
    const expiresAt = data.expiresAt?.toDate?.() || (typeof data.expiresAt === 'string' ? new Date(data.expiresAt) : null);
    if (expiresAt && expiresAt.getTime() < Date.now()) {
      batch.delete(inviteDoc.ref);
      continue;
    }

    const memberRef = adminDb.doc(`workspaces/${workspaceId}/members/${uid}`);
    const memberSnap = await memberRef.get();

    if (!memberSnap.exists) {
      batch.set(memberRef, {
        uid,
        email: normalizedEmail,
        role: data.role || 'member',
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
  let emailVerified = false;

  if (token) {
    let decoded: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>;
    try {
      // checkRevoked=true consults Firebase's tokensValidAfterTime, so
      // password resets / logoutAll / account compromise revoke immediately.
      decoded = await adminAuth.verifyIdToken(token, true);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (
        message.includes('id token') ||
        message.includes('jwt') ||
        message.includes('token') ||
        message.includes('credential') ||
        message.includes('revoked')
      ) {
        throw new Error('UNAUTHENTICATED');
      }
      throw error;
    }

    uid = decoded.uid;
    email = normalizeEmail(decoded.email) || undefined;
    emailVerified = decoded.email_verified === true;
  } else if (sessionCookie) {
    const decoded = await decodeSessionCookie(sessionCookie);
    if (!decoded) {
      throw new Error('UNAUTHENTICATED');
    }

    uid = decoded.uid;
    let userRecord: Awaited<ReturnType<typeof adminAuth.getUser>>;
    try {
      userRecord = await adminAuth.getUser(uid);
    } catch {
      throw new Error('UNAUTHENTICATED');
    }

    // Enforce revocation: if the user's refresh tokens were revoked after
    // the cookie was issued, treat the cookie as invalid.
    const validAfter = userRecord.tokensValidAfterTime
      ? Date.parse(userRecord.tokensValidAfterTime)
      : 0;
    if (validAfter && decoded.issuedAtMs < validAfter) {
      throw new Error('UNAUTHENTICATED');
    }
    if (userRecord.disabled) {
      throw new Error('UNAUTHENTICATED');
    }

    email = normalizeEmail(userRecord.email) || undefined;
    emailVerified = userRecord.emailVerified === true;
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

  const resolved = await resolveContextForUser(uid, email, requestedWs);

  return { ...resolved, emailVerified };
}

async function resolveContextForUser(
  uid: string,
  email: string | undefined,
  requestedWs: string,
): Promise<ResolvedWorkspaceContext> {
  const requestedMembership = await getWorkspaceMembership(uid, requestedWs);
  if (requestedMembership) {
    return { uid, email, workspaceId: requestedMembership.workspaceId, role: requestedMembership.role };
  }

  if (requestedWs !== DEFAULT_WORKSPACE_ID) {
    throw new Error('FORBIDDEN_WORKSPACE');
  }

  const membership = await findUserMembership(uid);
  if (membership) {
    return { uid, email, workspaceId: membership.workspaceId, role: membership.role };
  }

  return bootstrapPersonalWorkspace(uid, email);
}
