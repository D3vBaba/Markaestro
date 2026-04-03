import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { createHash } from 'node:crypto';
import { DEFAULT_WORKSPACE_ID, getWorkspaceId, isValidWorkspaceId } from '@/lib/workspace';

export type RequestContext = {
  uid: string;
  email?: string;
  workspaceId: string;
  role: 'owner' | 'admin' | 'member';
};

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') || '';
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function personalWorkspaceId(uid: string): string {
  const hash = createHash('sha256').update(uid).digest('hex').slice(0, 24);
  return `ws-${hash}`;
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

export async function requireContext(req: Request): Promise<RequestContext> {
  const token = getBearerToken(req);
  if (!token) throw new Error('UNAUTHENTICATED');

  const decoded = await adminAuth.verifyIdToken(token);
  const uid = decoded.uid;
  const email = decoded.email;

  const url = new URL(req.url);
  const requestedWs = getWorkspaceId(
    url.searchParams.get('workspaceId') || req.headers.get('x-workspace-id'),
  );

  if (!isValidWorkspaceId(requestedWs)) {
    throw new Error('VALIDATION_INVALID_WORKSPACE_ID');
  }

  if (requestedWs !== DEFAULT_WORKSPACE_ID) {
    const memberRef = adminDb.doc(`workspaces/${requestedWs}/members/${uid}`);
    const memberSnap = await memberRef.get();

    if (!memberSnap.exists) {
      throw new Error('FORBIDDEN_WORKSPACE');
    }

    const role = (memberSnap.data()?.role || 'member') as RequestContext['role'];
    return { uid, email, workspaceId: requestedWs, role };
  }

  const membership = await findUserMembership(uid);
  if (membership) {
    return { uid, email, workspaceId: membership.workspaceId, role: membership.role };
  }

  return bootstrapPersonalWorkspace(uid, email);
}
