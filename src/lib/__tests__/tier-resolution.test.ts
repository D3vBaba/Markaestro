import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PLAN_TIERS, type PlanTier } from '@/lib/stripe/plans';
import { tierFromPriceId, priceIdForPlan, type SubscriptionRecord } from '@/lib/stripe/server';
import { pickEffectiveSubscription } from '@/lib/stripe/subscription';

describe('tierFromPriceId & priceIdForPlan', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Populate test price env vars for every purchasable tier
    for (const tier of PLAN_TIERS) {
      process.env[`STRIPE_PRICE_${tier.toUpperCase()}_MONTHLY`] = `price_${tier}_monthly`;
      process.env[`STRIPE_PRICE_${tier.toUpperCase()}_ANNUAL`] = `price_${tier}_annual`;
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('resolves price IDs for all defined PLAN_TIERS', () => {
    for (const tier of PLAN_TIERS) {
      expect(priceIdForPlan(tier, 'monthly')).toBe(`price_${tier}_monthly`);
      expect(priceIdForPlan(tier, 'annual')).toBe(`price_${tier}_annual`);
    }
  });

  it('maps Stripe Price IDs back to the correct tier and interval', () => {
    for (const tier of PLAN_TIERS) {
      const monthly = tierFromPriceId(`price_${tier}_monthly`);
      expect(monthly).toEqual({ tier, interval: 'monthly' });

      const annual = tierFromPriceId(`price_${tier}_annual`);
      expect(annual).toEqual({ tier, interval: 'annual' });
    }
  });

  it('returns null for unmapped or unknown price IDs', () => {
    expect(tierFromPriceId('price_unknown_123')).toBeNull();
    expect(priceIdForPlan('nonexistent', 'monthly')).toBeNull();
  });
});

describe('Dynamic tierRank via pickEffectiveSubscription', () => {
  function makeSub(tier: PlanTier, status = 'active'): SubscriptionRecord {
    return {
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      stripePriceId: `price_${tier}`,
      tier,
      interval: 'monthly',
      status,
      trialEnd: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      updatedAt: new Date().toISOString(),
    };
  }

  it('ranks tiers in order of PLAN_TIERS', () => {
    // For every consecutive pair in PLAN_TIERS, the latter has higher rank
    for (let i = 0; i < PLAN_TIERS.length - 1; i++) {
      const lowerTier = PLAN_TIERS[i];
      const higherTier = PLAN_TIERS[i + 1];

      const accountLower = makeSub(lowerTier);
      const workspaceHigher = makeSub(higherTier);

      // Higher tier wins regardless of whether it is on account or workspace
      expect(pickEffectiveSubscription(accountLower, workspaceHigher)?.tier).toBe(higherTier);

      const accountHigher = makeSub(higherTier);
      const workspaceLower = makeSub(lowerTier);
      expect(pickEffectiveSubscription(accountHigher, workspaceLower)?.tier).toBe(higherTier);
    }
  });
});
