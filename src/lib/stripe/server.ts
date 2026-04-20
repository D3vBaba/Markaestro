import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    _stripe = new Stripe(key);
  }
  return _stripe;
}

export type SubscriptionRecord = {
  /** Workspace the subscription belongs to. Populated for new records; absent on legacy uid-keyed docs. */
  workspaceId?: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  tier: string;
  interval: string;
  status: string;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: string;
};

/**
 * Maps a Stripe Price ID to our plan tier.
 * Price IDs are stored in env vars as STRIPE_PRICE_{TIER}_{INTERVAL}.
 */
export function tierFromPriceId(priceId: string): { tier: string; interval: string } | null {
  const map: Record<string, { tier: string; interval: string }> = {};
  const tiers = ['starter', 'pro', 'business'] as const;
  const intervals = ['monthly', 'annual'] as const;

  for (const tier of tiers) {
    for (const interval of intervals) {
      const envKey = `STRIPE_PRICE_${tier.toUpperCase()}_${interval.toUpperCase()}`;
      const id = process.env[envKey];
      if (id) map[id] = { tier, interval };
    }
  }

  return map[priceId] ?? null;
}

export function priceIdForPlan(tier: string, interval: string): string | null {
  const envKey = `STRIPE_PRICE_${tier.toUpperCase()}_${interval.toUpperCase()}`;
  return process.env[envKey] ?? null;
}
