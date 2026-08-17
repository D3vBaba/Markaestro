import { adminDb } from "@/lib/firebase-admin";
import { apiError, apiOk } from "@/lib/api-response";
import { requireContext } from "@/lib/server-auth";
import { getEffectiveSubscription } from "@/lib/stripe/subscription";
import { countPendingInvitesForEmail } from "@/lib/team-invites";

export const runtime = 'nodejs';


export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const [effectiveSubscription, productSnapshot, pendingInvites] = await Promise.all([
      getEffectiveSubscription({ uid: ctx.uid, workspaceId: ctx.workspaceId }),
      adminDb.collection(`workspaces/${ctx.workspaceId}/products`).limit(1).get(),
      // Invitees with a pending invite are joining an existing workspace —
      // the client must offer the invite instead of routing them into
      // personal onboarding (quiz + paywall).
      ctx.email && ctx.emailVerified
        ? countPendingInvitesForEmail(ctx.email).catch(() => 0)
        : Promise.resolve(0),
    ]);

    const hasSubscriptionHistory = Boolean(effectiveSubscription);
    const hasProducts = !productSnapshot.empty;
    const completed = hasSubscriptionHistory || hasProducts;

    // Whether ANY workspace the user belongs to is set up. The onboarding
    // gate is for genuinely new accounts — an established user switching
    // into a freshly created (empty) workspace must not be funneled back
    // through the quiz and paywall.
    let anyWorkspaceActivity = completed;
    if (!anyWorkspaceActivity) {
      try {
        const membershipsSnap = await adminDb
          .collectionGroup('members')
          .where('uid', '==', ctx.uid)
          .limit(20)
          .get();
        const otherWorkspaceIds = membershipsSnap.docs
          .map((d) => d.ref.path.split('/')[1])
          .filter((id) => Boolean(id) && id !== ctx.workspaceId);

        const checks = await Promise.all(
          otherWorkspaceIds.map(async (id) => {
            const [productSnap, subSnap] = await Promise.all([
              adminDb.collection(`workspaces/${id}/products`).limit(1).get(),
              adminDb.doc(`subscriptions/${id}`).get(),
            ]);
            return !productSnap.empty || subSnap.exists;
          }),
        );
        anyWorkspaceActivity = checks.some(Boolean);
      } catch {
        // Non-fatal: fall back to the current workspace's state.
      }
    }

    return apiOk({
      completed,
      hasProducts,
      hasSubscriptionHistory,
      pendingInvites,
      anyWorkspaceActivity,
    });
  } catch (error) {
    return apiError(error);
  }
}
