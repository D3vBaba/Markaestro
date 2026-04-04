import { adminDb } from "@/lib/firebase-admin";
import { apiError, apiOk } from "@/lib/api-response";
import { requireContext } from "@/lib/server-auth";
import { getEffectiveSubscription, getSubscription } from "@/lib/stripe/subscription";

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const [ownSubscription, effectiveSubscription, productSnapshot] = await Promise.all([
      getSubscription(ctx.uid),
      getEffectiveSubscription(ctx.uid, ctx.workspaceId),
      adminDb.collection(`workspaces/${ctx.workspaceId}/products`).limit(1).get(),
    ]);

    const hasSubscriptionHistory = Boolean(ownSubscription || effectiveSubscription);
    const hasProducts = !productSnapshot.empty;

    return apiOk({
      completed: hasSubscriptionHistory || hasProducts,
      hasProducts,
      hasSubscriptionHistory,
    });
  } catch (error) {
    return apiError(error);
  }
}
