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
  /** Quantity of the 'Extra brand' add-on subscription item. */
  addonBrands?: number;
  /** Quantity of the 'Extra seat' add-on subscription item. */
  addonSeats?: number;
  updatedAt: string;
};

/**
 * True when the record points at a real Stripe customer. Manual grants and
 * comps store placeholder ids (`manual_grant_<uid>`); passing those to the
 * billing portal or checkout APIs fails with "No such customer".
 */
export function hasStripeCustomer<T extends Pick<SubscriptionRecord, 'stripeCustomerId'>>(
  sub: T | null | undefined,
): sub is T {
  return Boolean(sub?.stripeCustomerId?.startsWith('cus_'));
}

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

/**
 * Add-on prices live in env as STRIPE_PRICE_ADDON_{BRAND|SEAT}_{INTERVAL}.
 * Unset env (add-ons not yet provisioned in Stripe) resolves to null and the
 * add-ons API reports them unavailable rather than failing checkout paths.
 */
export function addonPriceId(addon: 'brand' | 'seat', interval: string): string | null {
  const envKey = `STRIPE_PRICE_ADDON_${addon.toUpperCase()}_${interval.toUpperCase()}`;
  return process.env[envKey] ?? null;
}

export function addonFromPriceId(priceId: string): 'brand' | 'seat' | null {
  for (const addon of ['brand', 'seat'] as const) {
    for (const interval of ['monthly', 'annual'] as const) {
      if (addonPriceId(addon, interval) === priceId) return addon;
    }
  }
  return null;
}
