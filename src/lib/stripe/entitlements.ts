import { PLANS, type PlanConfig, type PlanLimits, type PlanTier } from './plans';
import type { SubscriptionRecord } from './server';
import {
  effectiveTier,
  getEffectiveSubscription,
  isActiveSubscription,
} from './subscription';

export type EffectiveLimits = PlanLimits & { tier: PlanTier };

/**
 * The limits a subscription record actually grants, with add-on quantities
 * (extra brands / extra seats, purchased as Stripe subscription items and
 * synced by the webhook) applied on top of the base plan. Add-ons only count
 * while the subscription is active, and seat add-ons only exist on Pro —
 * matching ADDONS.availableOn in plans.ts.
 */
export function resolveLimits(sub: SubscriptionRecord | null | undefined): EffectiveLimits {
  const tier = effectiveTier(sub);
  const base = PLANS[tier].limits;
  const active = isActiveSubscription(sub);
  const addonBrands = active ? Math.max(0, sub?.addonBrands ?? 0) : 0;
  const addonSeats = active && tier === 'pro' ? Math.max(0, sub?.addonSeats ?? 0) : 0;

  return {
    tier,
    ...base,
    brands: base.brands === -1 ? -1 : base.brands + addonBrands,
    teamMembers: base.teamMembers === -1 ? -1 : base.teamMembers + addonSeats,
  };
}

/** Resolve limits for a user acting inside a workspace (account entitlement + workspace subscription). */
export async function getEffectiveLimits(
  uid?: string,
  workspaceId?: string,
): Promise<EffectiveLimits> {
  const sub = await getEffectiveSubscription({ uid, workspaceId });
  return resolveLimits(sub);
}

/** Whether the record's effective tier includes a gated feature. */
export function hasFeature(
  sub: SubscriptionRecord | null | undefined,
  feature: keyof PlanConfig['gated'],
): boolean {
  return PLANS[effectiveTier(sub)].gated[feature];
}
