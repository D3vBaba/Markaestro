import type { RequestContext } from '@/lib/server-auth';
import type { PlanConfig } from '@/lib/stripe/plans';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { hasFeature } from '@/lib/stripe/entitlements';
import { requireIntelligencePhase, type IntelligencePhase } from './feature-flags';
import { requireIntelligencePreviewUser } from './preview-access';

export async function requireIntelligenceAccess(
  ctx: RequestContext,
  phase: IntelligencePhase,
  feature: keyof PlanConfig['gated'],
): Promise<void> {
  requireIntelligencePreviewUser(ctx);
  const subscription = await getEffectiveSubscription(ctx.uid, ctx.workspaceId);
  await requireIntelligencePhase({
    phase,
    uid: ctx.uid,
    workspaceId: ctx.workspaceId,
    entitled: hasFeature(subscription, feature),
  });
}
