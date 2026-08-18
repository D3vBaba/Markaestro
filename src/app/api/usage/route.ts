import { requireContext } from '@/lib/server-auth';
import { apiOk, apiError } from '@/lib/api-response';
import { getUsage, storageLimitBytes } from '@/lib/usage';
import { getEffectiveLimits } from '@/lib/stripe/entitlements';
import { PLANS } from '@/lib/stripe/plans';
import { adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';


/** GET /api/usage — return current month's usage counts + effective plan limits */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);

    const [usage, limits] = await Promise.all([
      getUsage(ctx.uid, ctx.workspaceId),
      // Effective limits: base plan plus any add-on brands/seats.
      getEffectiveLimits(ctx.uid, ctx.workspaceId),
    ]);

    let productCount = 0;
    let memberCount = 0;
    let ownedWorkspaceCount = 0;
    try {
      const [productsSnap, membersSnap, ownedSnap] = await Promise.all([
        adminDb.collection(`workspaces/${ctx.workspaceId}/products`).count().get(),
        adminDb.collection(`workspaces/${ctx.workspaceId}/members`).count().get(),
        adminDb.collectionGroup('members')
          .where('uid', '==', ctx.uid)
          .where('role', '==', 'owner')
          .count()
          .get(),
      ]);
      productCount = productsSnap.data().count;
      memberCount = membersSnap.data().count;
      ownedWorkspaceCount = ownedSnap.data().count;
    } catch { /* non-fatal */ }

    const storageLimit = storageLimitBytes(limits);

    return apiOk({
      usage: {
        // Storage is cumulative (bytes currently stored), not monthly.
        storage: {
          current: usage.storageBytes,
          limit: storageLimit === -1 ? null : storageLimit,
        },
        posts: { current: usage.posts, limit: limits.postsPerMonth },
        // Brands are stored as products; the channel cap is per brand, so a
        // single workspace-wide channel count is no longer reported.
        brands: { current: productCount, limit: limits.brands },
        teamMembers: {
          current: memberCount,
          limit: limits.teamMembers,
        },
        workspaces: {
          current: ownedWorkspaceCount,
          limit: limits.workspaces,
        },
      },
      tier: limits.tier,
      plan: PLANS[limits.tier].name,
    });
  } catch (error) {
    return apiError(error);
  }
}
