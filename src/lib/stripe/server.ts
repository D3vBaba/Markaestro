import Stripe from 'stripe';
import { PLANS, PLAN_TIERS, type BillingInterval, type PlanTier } from './plans';

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
  const tiers = PLAN_TIERS;
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

/**
 * Cents a plan charges for ONE billing period at this interval. `price.annual`
 * is the per-month figure the pricing page shows for annual billing, so the
 * yearly charge is twelve of them.
 */
export function expectedUnitAmount(tier: PlanTier, interval: BillingInterval): number {
  const plan = PLANS[tier];
  return interval === 'annual'
    ? Math.round(plan.price.annual * 12 * 100)
    : Math.round(plan.price.monthly * 100);
}

/** Whether a Stripe price charges exactly what we advertise for this plan. */
export function priceMatchesPlan(
  price: Pick<Stripe.Price, 'currency' | 'unit_amount' | 'recurring'>,
  tier: PlanTier,
  interval: BillingInterval,
): boolean {
  return (
    price.currency === 'usd' &&
    price.unit_amount === expectedUnitAmount(tier, interval) &&
    price.recurring?.interval === (interval === 'annual' ? 'year' : 'month') &&
    price.recurring?.interval_count === 1
  );
}

export type PlanPriceResolution =
  | { ok: true; priceId: string; substituted: boolean }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'UNRESOLVABLE' };

/**
 * The price id to charge for a plan, verified against Stripe.
 *
 * Env config drifts: prices get re-created in the dashboard and the old ones
 * archived, and a deploy carrying a stale `STRIPE_PRICE_*` value then fails
 * every checkout with "The price specified is inactive" — a 500 that reads to
 * the user as a broken payment integration.
 *
 * So the configured id is checked, not trusted. If it is archived (or gone),
 * fall back to the active price on the SAME product that charges exactly the
 * advertised amount for this tier and interval. The amount match is what makes
 * the fallback safe: checkout can never open on a price the pricing page does
 * not show. When nothing matches, refuse rather than guess.
 */
export async function resolvePlanPrice(
  stripe: Stripe,
  tier: PlanTier,
  interval: BillingInterval,
): Promise<PlanPriceResolution> {
  const configured = priceIdForPlan(tier, interval);
  if (!configured) return { ok: false, reason: 'NOT_CONFIGURED' };

  let price: Stripe.Price | null = null;
  try {
    price = await stripe.prices.retrieve(configured);
  } catch {
    // Deleted, or belongs to another account/mode. Treated as drift below.
    price = null;
  }

  if (price?.active && priceMatchesPlan(price, tier, interval)) {
    return { ok: true, priceId: price.id, substituted: false };
  }

  const productId = typeof price?.product === 'string' ? price.product : price?.product?.id;
  if (!productId) return { ok: false, reason: 'UNRESOLVABLE' };

  const candidates = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const match = candidates.data.find((candidate) => priceMatchesPlan(candidate, tier, interval));
  if (!match) return { ok: false, reason: 'UNRESOLVABLE' };

  return { ok: true, priceId: match.id, substituted: true };
}
