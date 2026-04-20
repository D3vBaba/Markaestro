import { adminDb } from "@/lib/firebase-admin";
import { apiError, apiOk } from "@/lib/api-response";
import { requireContext } from "@/lib/server-auth";
import { getEffectiveSubscription } from "@/lib/stripe/subscription";

export const runtime = 'nodejs';


export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const [effectiveSubscription, productSnapshot] = await Promise.all([
      getEffectiveSubscription({ uid: ctx.uid, workspaceId: ctx.workspaceId }),
      adminDb.collection(`workspaces/${ctx.workspaceId}/products`).limit(1).get(),
    ]);

    const hasSubscriptionHistory = Boolean(effectiveSubscription);
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
