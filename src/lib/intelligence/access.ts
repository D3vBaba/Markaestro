import type { RequestContext } from '@/lib/server-auth';
import type { PlanConfig } from '@/lib/stripe/plans';
import type { SubscriptionRecord } from '@/lib/stripe/server';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { hasFeature } from '@/lib/stripe/entitlements';
import { requireIntelligencePhase, type IntelligencePhase } from './feature-flags';
import { requireIntelligencePreviewUser } from './preview-access';

/**
 * The one gate every Intelligence surface goes through.
 *
 * Six routes used to hand-roll the same two calls, which is how
 * `/api/intelligence/conversions` ended up with no intelligence gate at all:
 * there was nothing to notice missing. Routes call this and only this.
 */
export async function requireIntelligenceAccess(
  ctx: RequestContext,
  phase: IntelligencePhase,
  feature: keyof PlanConfig['gated'],
  options: {
    /**
     * Pass the subscription when the caller already needed it (for
     * `resolveLimits`, typically) so the gate does not read it a second time.
     */
    subscription?: SubscriptionRecord | null;
  } = {},
): Promise<void> {
  await requireIntelligencePreviewUser(ctx);
  const subscription = options.subscription !== undefined
    ? options.subscription
    : await getEffectiveSubscription(ctx.uid, ctx.workspaceId);
  await requireIntelligencePhase({
    phase,
    uid: ctx.uid,
    workspaceId: ctx.workspaceId,
    entitled: hasFeature(subscription, feature),
  });
}
