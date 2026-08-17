import { requireContext } from '@/lib/server-auth';
import { apiOk, apiError } from '@/lib/api-response';
import { getUsage } from '@/lib/usage';
import { getEffectiveSubscription, effectiveTier } from '@/lib/stripe/subscription';
import { PLANS } from '@/lib/stripe/plans';
import { adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';


/** GET /api/usage — return current month's usage counts + plan limits */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);

    const [usage, sub] = await Promise.all([
      getUsage(ctx.uid, ctx.workspaceId),
      getEffectiveSubscription(ctx.uid, ctx.workspaceId),
    ]);

    const tier = effectiveTier(sub);
    const plan = PLANS[tier];

    let productCount = 0;
    let channelCount = 0;
    let memberCount = 0;
    let ownedWorkspaceCount = 0;
    try {
      const [productsSnap, connectionsSnap, membersSnap, ownedSnap] = await Promise.all([
        adminDb.collection(`workspaces/${ctx.workspaceId}/products`).count().get(),
        adminDb.collection(`workspaces/${ctx.workspaceId}/platformConnections`).count().get(),
        adminDb.collection(`workspaces/${ctx.workspaceId}/members`).count().get(),
        adminDb.collectionGroup('members')
          .where('uid', '==', ctx.uid)
          .where('role', '==', 'owner')
          .count()
          .get(),
      ]);
      productCount = productsSnap.data().count;
      channelCount = connectionsSnap.data().count;
      memberCount = membersSnap.data().count;
      ownedWorkspaceCount = ownedSnap.data().count;
    } catch { /* non-fatal */ }

    return apiOk({
      usage: {
        mediaUploads: { current: usage.mediaUploads, limit: plan.limits.mediaUploads },
        channels: { current: channelCount, limit: plan.limits.channels },
        teamMembers: {
          current: memberCount,
          limit: plan.limits.teamMembers,
        },
        workspaces: {
          current: ownedWorkspaceCount,
          limit: plan.limits.workspaces,
        },
        products: { current: productCount },
      },
      tier,
      plan: plan.name,
    });
  } catch (error) {
    return apiError(error);
  }
}
