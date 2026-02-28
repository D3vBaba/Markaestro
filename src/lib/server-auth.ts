import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getWorkspaceId } from '@/lib/workspace';

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

export async function requireContext(req: Request): Promise<RequestContext> {
  const token = getBearerToken(req);
  if (!token) throw new Error('UNAUTHENTICATED');

  const decoded = await adminAuth.verifyIdToken(token);
  const uid = decoded.uid;
  const email = decoded.email;

  const url = new URL(req.url);
  const requestedWs = getWorkspaceId(url.searchParams.get('workspaceId') || req.headers.get('x-workspace-id'));

  const memberRef = adminDb.doc(`workspaces/${requestedWs}/members/${uid}`);
  const memberSnap = await memberRef.get();

  if (!memberSnap.exists) {
    // First-user bootstrap for a workspace
    const wsRef = adminDb.doc(`workspaces/${requestedWs}`);
    const wsSnap = await wsRef.get();
    if (!wsSnap.exists) {
      await wsRef.set({
        name: requestedWs === 'default' ? 'Default Workspace' : requestedWs,
        slug: requestedWs,
        createdAt: new Date().toISOString(),
        createdBy: uid,
      });
      await memberRef.set({
        uid,
        email: email || '',
        role: 'owner',
        joinedAt: new Date().toISOString(),
      });
      return { uid, email, workspaceId: requestedWs, role: 'owner' };
    }
    throw new Error('FORBIDDEN_WORKSPACE');
  }

  const role = (memberSnap.data()?.role || 'member') as 'owner' | 'admin' | 'member';
  return { uid, email, workspaceId: requestedWs, role };
}
