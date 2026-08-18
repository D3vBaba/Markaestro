import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { createHash } from 'node:crypto';
import { DEFAULT_WORKSPACE_ID, WORKSPACE_COOKIE, getWorkspaceId, isValidWorkspaceId, shouldDeferPersonalWorkspace } from '@/lib/workspace';
import { countPendingInvitesForEmail } from '@/lib/team-invites';
import { decodeSessionCookie } from '@/lib/session-cookie';
import { parseBearerToken } from '@/lib/bearer';
import { pickLocaleFromAcceptLanguage } from '@/i18n/routing';
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

function getCookie(req: Request, cookieName: string): string | null {
  const cookieHeader = req.headers.get('cookie') || '';
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name === cookieName) {
      const value = valueParts.join('=').trim();
      return value || null;
    }
  }

  return null;
}

function getSessionCookie(req: Request): string | null {
  return getCookie(req, '__session');
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

async function bootstrapPersonalWorkspace(
  uid: string,
  email?: string,
  acceptLanguage?: string | null,
): Promise<ResolvedWorkspaceContext> {
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
        locale: pickLocaleFromAcceptLanguage(acceptLanguage),
      });
    }
  });

  return { uid, email, workspaceId, role: 'owner' };
}

/**
 * The workspace a user lands in when they haven't picked one. Deterministic:
 * owned workspaces first (your own workspace beats one you were invited to),
 * then earliest joined, then workspaceId as a stable tiebreak. The old
 * unordered limit(1) query made a multi-workspace user's default an index
 * coin flip.
 */
async function findUserMembership(uid: string): Promise<{ workspaceId: string; role: RequestContext['role'] } | null> {
  const snap = await adminDb
    .collectionGroup('members')
    .where('uid', '==', uid)
    .get();

  if (snap.empty) {
    return null;
  }

  const memberships = snap.docs
    .map((doc) => {
      const workspaceId = doc.ref.path.split('/')[1];
      const data = doc.data();
      return {
        workspaceId,
        role: (data.role || 'member') as RequestContext['role'],
        joinedAt: (data.joinedAt as string) || '',
      };
    })
    .filter((m) => Boolean(m.workspaceId) && m.workspaceId !== DEFAULT_WORKSPACE_ID);

  if (memberships.length === 0) return null;

  memberships.sort((a, b) => {
    const ownerDiff = Number(b.role === 'owner') - Number(a.role === 'owner');
    if (ownerDiff !== 0) return ownerDiff;
    const joinedDiff = a.joinedAt.localeCompare(b.joinedAt);
    if (joinedDiff !== 0) return joinedDiff;
    return a.workspaceId.localeCompare(b.workspaceId);
  });

  const chosen = memberships[0];
  return { workspaceId: chosen.workspaceId, role: chosen.role };
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

  const acceptLanguage = req.headers.get('accept-language');

  const url = new URL(req.url);
  const requestedWs = getWorkspaceId(
    url.searchParams.get('workspaceId') || req.headers.get('x-workspace-id'),
  );

  if (!isValidWorkspaceId(requestedWs)) {
    throw new Error('VALIDATION_INVALID_WORKSPACE_ID');
  }

  const cookieWs = getCookie(req, WORKSPACE_COOKIE);

  const resolved = await resolveContextForUser(
    uid,
    email,
    requestedWs,
    cookieWs,
    acceptLanguage,
    emailVerified,
  );

  return { ...resolved, emailVerified };
}

async function resolveContextForUser(
  uid: string,
  email: string | undefined,
  requestedWs: string,
  cookieWs: string | null,
  acceptLanguage?: string | null,
  emailVerified = false,
): Promise<ResolvedWorkspaceContext> {
  // An explicit selection (query param / header) is strict: requesting a
  // workspace you're not a member of is an authorization failure, never a
  // silent redirect to a different workspace.
  if (requestedWs !== DEFAULT_WORKSPACE_ID) {
    const requestedMembership = await getWorkspaceMembership(uid, requestedWs);
    if (requestedMembership) {
      return { uid, email, workspaceId: requestedMembership.workspaceId, role: requestedMembership.role };
    }
    throw new Error('FORBIDDEN_WORKSPACE');
  }

  // The cookie is the persisted UI selection. It is advisory: if it points
  // at a workspace the user has since left or was removed from, fall through
  // to the deterministic default instead of bricking every request.
  if (cookieWs && cookieWs !== DEFAULT_WORKSPACE_ID && isValidWorkspaceId(cookieWs)) {
    const cookieMembership = await getWorkspaceMembership(uid, cookieWs);
    if (cookieMembership) {
      return { uid, email, workspaceId: cookieMembership.workspaceId, role: cookieMembership.role };
    }
  }

  const membership = await findUserMembership(uid);
  if (membership) {
    return { uid, email, workspaceId: membership.workspaceId, role: membership.role };
  }

  // A first-time invitee has no memberships yet. Creating a personal
  // workspace here would make them an owner, and owned-first defaulting
  // would keep them in that empty workspace after they join the team.
  if (email && emailVerified) {
    try {
      const pendingInviteCount = await countPendingInvitesForEmail(email);
      if (shouldDeferPersonalWorkspace(emailVerified, pendingInviteCount)) {
        return { uid, email, workspaceId: DEFAULT_WORKSPACE_ID, role: 'member' };
      }
    } catch {
      // Invite lookup is advisory; fall through to a personal workspace.
    }
  }

  return bootstrapPersonalWorkspace(uid, email, acceptLanguage);
}
