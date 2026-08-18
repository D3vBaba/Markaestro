import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { apiOk, apiError } from '@/lib/api-response';
import {
  getAccountEntitlement,
  getSubscriptionForWorkspace,
} from '@/lib/stripe/subscription';
import { resolveLimits } from '@/lib/stripe/entitlements';
import { isValidWorkspaceId, workspaceSlugFromName } from '@/lib/workspace';
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

    // The limit basis is the user's OWN entitlements: their account
    // entitlement plus the subscriptions of workspaces they own. Being a
    // member of someone else's premium workspace must not raise how many
    // personal workspaces they can create.
    const ownedSnap = await adminDb
      .collectionGroup('members')
      .where('uid', '==', ctx.uid)
      .where('role', '==', 'owner')
      .get();
    const ownedWorkspaceIds = ownedSnap.docs
      .map((d) => d.ref.path.split('/')[1])
      .filter(Boolean);

    const [account, ownedSubs] = await Promise.all([
      getAccountEntitlement(ctx.uid),
      Promise.all(ownedWorkspaceIds.map((id) => getSubscriptionForWorkspace(id))),
    ]);

    // No sub at all resolves to the free tier's single workspace.
    let limit = resolveLimits(account).workspaces;
    for (const ownedSub of ownedSubs) {
      const ownedLimit = resolveLimits(ownedSub).workspaces;
      if (ownedLimit === -1) limit = -1;
      else if (limit !== -1) limit = Math.max(limit, ownedLimit);
    }

    if (limit !== -1 && ownedWorkspaceIds.length >= limit) {
      return apiError(new Error('WORKSPACE_LIMIT_REACHED'));
    }

    const body = await req.json();
    const { name } = createSchema.parse(body);

    const slug = workspaceSlugFromName(name);
    if (!isValidWorkspaceId(slug)) {
      // Defensive: the generator only emits [a-z0-9-] starting alphanumeric,
      // so this indicates a generator bug rather than bad input.
      throw new Error('VALIDATION_INVALID_WORKSPACE_ID');
    }

    const now = new Date().toISOString();
    const wsRef = adminDb.doc(`workspaces/${slug}`);
    const memberRef = adminDb.doc(`workspaces/${slug}/members/${ctx.uid}`);

    // Atomic: workspace doc and owner membership are written together.
    // create() (not set) fails on the improbable id collision instead of
    // silently overwriting an existing workspace.
    const batch = adminDb.batch();
    batch.create(wsRef, { name, slug, createdAt: now, createdBy: ctx.uid });
    batch.create(memberRef, { uid: ctx.uid, email: ctx.email ?? '', role: 'owner', joinedAt: now });
    await batch.commit();

    return apiOk({ id: slug, name, role: 'owner' }, 201);
  } catch (error) {
    return apiError(error);
  }
}
