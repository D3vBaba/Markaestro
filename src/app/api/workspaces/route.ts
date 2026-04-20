import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { apiOk, apiError } from '@/lib/api-response';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { PLANS } from '@/lib/stripe/plans';
import type { PlanTier } from '@/lib/stripe/plans';
import { z } from 'zod';

export const runtime = 'nodejs';


const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

/** GET /api/workspaces — list all workspaces the current user belongs to */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    let workspaceIds: Array<{ workspaceId: string; role: string | undefined }> = [];

    try {
      const snap = await adminDb
        .collectionGroup('members')
        .where('uid', '==', ctx.uid)
        .get();

      workspaceIds = snap.docs.map((d) => {
        const parts = d.ref.path.split('/');
        return { workspaceId: parts[1], role: d.data().role };
      });
    } catch {
      workspaceIds = [{ workspaceId: ctx.workspaceId, role: ctx.role }];
    }

    const uniqueWorkspaceIds = Array.from(
      new Map(workspaceIds.map((entry) => [entry.workspaceId, entry])).values(),
    );

    const workspaces = await Promise.all(
      uniqueWorkspaceIds.map(async ({ workspaceId, role }) => {
        const wsSnap = await adminDb.doc(`workspaces/${workspaceId}`).get();
        return {
          id: workspaceId,
          name: wsSnap.data()?.name ?? workspaceId,
          role,
        };
      }),
    );

    return apiOk({ workspaces });
  } catch (error) {
    return apiError(error);
  }
}

/** POST /api/workspaces — create a new workspace */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);

    const sub = await getEffectiveSubscription({ uid: ctx.uid, workspaceId: ctx.workspaceId });
    const tier = (sub?.tier ?? 'starter') as PlanTier;
    const limit = PLANS[tier]?.limits.workspaces ?? 1;

    if (limit !== -1) {
      let ownedWorkspaceCount = ctx.role === 'owner' ? 1 : 0;

      try {
        const snap = await adminDb
          .collectionGroup('members')
          .where('uid', '==', ctx.uid)
          .where('role', '==', 'owner')
          .get();
        ownedWorkspaceCount = snap.size;
      } catch {
        // Fall back to the current workspace when collection group queries are unavailable.
      }

      if (ownedWorkspaceCount >= limit) {
        return apiError(new Error('WORKSPACE_LIMIT_REACHED'));
      }
    }

    const body = await req.json();
    const { name } = createSchema.parse(body);

    // Generate a slug from the name
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      + '-' + Date.now().toString(36);

    const now = new Date().toISOString();
    const wsRef = adminDb.doc(`workspaces/${slug}`);
    const memberRef = adminDb.doc(`workspaces/${slug}/members/${ctx.uid}`);

    // Atomic: workspace doc and owner membership are written together
    const batch = adminDb.batch();
    batch.set(wsRef, { name, slug, createdAt: now, createdBy: ctx.uid });
    batch.set(memberRef, { uid: ctx.uid, email: ctx.email ?? '', role: 'owner', joinedAt: now });
    await batch.commit();

    return apiOk({ id: slug, name, role: 'owner' }, 201);
  } catch (error) {
    return apiError(error);
  }
}
