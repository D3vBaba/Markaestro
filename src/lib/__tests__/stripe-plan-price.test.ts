import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { expectedUnitAmount, priceMatchesPlan, resolvePlanPrice } from '../stripe/server';
import { PLANS, PLAN_TIERS } from '../stripe/plans';

const MONTHLY = { interval: 'month', interval_count: 1 } as Stripe.Price['recurring'];
const ANNUAL = { interval: 'year', interval_count: 1 } as Stripe.Price['recurring'];

function price(over: Partial<Stripe.Price>): Stripe.Price {
  return {
    id: 'price_x',
    active: true,
    currency: 'usd',
    unit_amount: 0,
    product: 'prod_x',
    recurring: MONTHLY,
    ...over,
  } as Stripe.Price;
}

function stripeStub(opts: { retrieve?: () => Promise<Stripe.Price>; list?: Stripe.Price[] }) {
  return {
    prices: {
      retrieve: vi.fn(opts.retrieve ?? (async () => { throw new Error('No such price'); })),
      list: vi.fn(async () => ({ data: opts.list ?? [] })),
    },
  } as unknown as Stripe;
}

const ENV_KEY = 'STRIPE_PRICE_STARTER_ANNUAL';

describe('expectedUnitAmount', () => {
  it('bills annual as twelve of the advertised monthly figure', () => {
    expect(expectedUnitAmount('starter', 'annual')).toBe(PLANS.starter.price.annual * 12 * 100);
    expect(expectedUnitAmount('starter', 'monthly')).toBe(PLANS.starter.price.monthly * 100);
  });

  it('is a whole number of cents for every purchasable plan', () => {
    for (const tier of PLAN_TIERS) {
      for (const interval of ['monthly', 'annual'] as const) {
        expect(Number.isInteger(expectedUnitAmount(tier, interval))).toBe(true);
      }
    }
  });
});

describe('priceMatchesPlan', () => {
  it('accepts the advertised amount, currency, and cadence', () => {
    expect(priceMatchesPlan(
      price({ unit_amount: expectedUnitAmount('pro', 'annual'), recurring: ANNUAL }),
      'pro',
      'annual',
    )).toBe(true);
  });

  it('rejects a different amount, currency, or cadence', () => {
    const amount = expectedUnitAmount('pro', 'monthly');
    expect(priceMatchesPlan(price({ unit_amount: amount + 100 }), 'pro', 'monthly')).toBe(false);
    expect(priceMatchesPlan(price({ unit_amount: amount, currency: 'eur' }), 'pro', 'monthly')).toBe(false);
    expect(priceMatchesPlan(price({ unit_amount: amount, recurring: ANNUAL }), 'pro', 'monthly')).toBe(false);
  });
});

describe('resolvePlanPrice', () => {
  it('reports NOT_CONFIGURED when the env var is missing', async () => {
    vi.stubEnv(ENV_KEY, '');
    await expect(resolvePlanPrice(stripeStub({}), 'starter', 'annual'))
      .resolves.toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
    vi.unstubAllEnvs();
  });

  it('uses the configured price when it is active and priced as advertised', async () => {
    vi.stubEnv(ENV_KEY, 'price_configured');
    const stripe = stripeStub({
      retrieve: async () => price({
        id: 'price_configured',
        unit_amount: expectedUnitAmount('starter', 'annual'),
        recurring: ANNUAL,
      }),
    });
    await expect(resolvePlanPrice(stripe, 'starter', 'annual'))
      .resolves.toEqual({ ok: true, priceId: 'price_configured', substituted: false });
    vi.unstubAllEnvs();
  });

  // The production failure: STRIPE_PRICE_STARTER_ANNUAL pointed at the archived
  // "Starter Annual v2" ($384/yr) and Stripe rejected every checkout with
  // "The price specified is inactive".
  it('falls back to the active price on the same product when the config is archived', async () => {
    vi.stubEnv(ENV_KEY, 'price_archived');
    const stripe = stripeStub({
      retrieve: async () => price({
        id: 'price_archived',
        active: false,
        product: 'prod_starter',
        unit_amount: 38400,
        recurring: ANNUAL,
      }),
      list: [
        price({ id: 'price_wrong_amount', product: 'prod_starter', unit_amount: 12345, recurring: ANNUAL }),
        price({
          id: 'price_live',
          product: 'prod_starter',
          unit_amount: expectedUnitAmount('starter', 'annual'),
          recurring: ANNUAL,
        }),
      ],
    });
    await expect(resolvePlanPrice(stripe, 'starter', 'annual'))
      .resolves.toEqual({ ok: true, priceId: 'price_live', substituted: true });
    vi.unstubAllEnvs();
  });

  it('refuses rather than charging an amount the pricing page never showed', async () => {
    vi.stubEnv(ENV_KEY, 'price_archived');
    const stripe = stripeStub({
      retrieve: async () => price({ id: 'price_archived', active: false, product: 'prod_starter', recurring: ANNUAL }),
      list: [price({ id: 'price_other', product: 'prod_starter', unit_amount: 99999, recurring: ANNUAL })],
    });
    await expect(resolvePlanPrice(stripe, 'starter', 'annual'))
      .resolves.toEqual({ ok: false, reason: 'UNRESOLVABLE' });
    vi.unstubAllEnvs();
  });

  it('reports UNRESOLVABLE when the configured price no longer exists at all', async () => {
    vi.stubEnv(ENV_KEY, 'price_gone');
    await expect(resolvePlanPrice(stripeStub({}), 'starter', 'annual'))
      .resolves.toEqual({ ok: false, reason: 'UNRESOLVABLE' });
    vi.unstubAllEnvs();
  });
});
