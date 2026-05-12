import { requireContext } from '@/lib/server-auth';
import { apiOk, apiError } from '@/lib/api-response';
import { getUsage } from '@/lib/usage';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { PLANS } from '@/lib/stripe/plans';
import type { PlanTier } from '@/lib/stripe/plans';
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

    const tier = (sub?.tier ?? 'starter') as PlanTier;
    const plan = PLANS[tier];

    // Count products and channels in this workspace
    let productCount = 0;
    let channelCount = 0;
    try {
      const productsSnap = await adminDb
        .collection(`workspaces/${ctx.workspaceId}/products`)
        .count()
        .get();
      productCount = productsSnap.data().count;

      // Count connected integrations as channels
      const integrationsSnap = await adminDb
        .collection(`workspaces/${ctx.workspaceId}/connections`)
        .get();
      channelCount = integrationsSnap.size;
    } catch { /* non-fatal */ }

    return apiOk({
      usage: {
        mediaUploads: { current: usage.mediaUploads, limit: plan.limits.mediaUploads },
        channels: { current: channelCount, limit: plan.limits.channels },
        teamMembers: {
          current: 0, // filled below
          limit: plan.limits.teamMembers,
        },
        workspaces: {
          current: 0, // filled below
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
