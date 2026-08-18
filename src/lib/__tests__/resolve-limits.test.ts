import { describe, expect, it } from 'vitest';
import { resolveLimits, hasFeature } from '../stripe/entitlements';
import { PLANS } from '../stripe/plans';
import type { SubscriptionRecord } from '../stripe/server';

function record(overrides: Partial<SubscriptionRecord>): SubscriptionRecord {
  return {
    stripeCustomerId: 'cus_test',
    stripeSubscriptionId: 'sub_test',
    stripePriceId: 'price_test',
    tier: 'starter',
    interval: 'monthly',
    status: 'active',
    trialEnd: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveLimits', () => {
  it('resolves missing and inactive records to the free tier without add-ons', () => {
    expect(resolveLimits(null)).toEqual({ tier: 'free', ...PLANS.free.limits });
    expect(resolveLimits(undefined)).toEqual({ tier: 'free', ...PLANS.free.limits });

    // A lapsed Pro with purchased add-ons entitles nothing beyond free.
    const lapsed = resolveLimits(
      record({ tier: 'pro', status: 'canceled', addonBrands: 4, addonSeats: 3 }),
    );
    expect(lapsed.tier).toBe('free');
    expect(lapsed.brands).toBe(PLANS.free.limits.brands);
    expect(lapsed.teamMembers).toBe(PLANS.free.limits.teamMembers);
  });

  it('adds brand-pack quantities on top of the base plan', () => {
    const starter = resolveLimits(record({ tier: 'starter', addonBrands: 3 }));
    expect(starter.brands).toBe(PLANS.starter.limits.brands + 3);
    // Seat add-ons are Pro-only; a stray quantity on Starter grants nothing.
    const starterWithSeats = resolveLimits(record({ tier: 'starter', addonSeats: 5 }));
    expect(starterWithSeats.teamMembers).toBe(PLANS.starter.limits.teamMembers);

    const pro = resolveLimits(record({ tier: 'pro', addonBrands: 2 }));
    expect(pro.brands).toBe(PLANS.pro.limits.brands + 2);
  });

  it('adds seat quantities on Pro only', () => {
    const pro = resolveLimits(record({ tier: 'pro', addonSeats: 2 }));
    expect(pro.teamMembers).toBe(PLANS.pro.limits.teamMembers + 2);

    // Trialing counts as active — add-ons apply during the trial.
    const trialing = resolveLimits(record({ tier: 'pro', status: 'trialing', addonSeats: 1 }));
    expect(trialing.teamMembers).toBe(PLANS.pro.limits.teamMembers + 1);
  });

  it('keeps Business unlimited limits unlimited regardless of add-ons', () => {
    const business = resolveLimits(record({ tier: 'business', addonSeats: 7, addonBrands: 0 }));
    expect(business.teamMembers).toBe(-1);
    expect(business.workspaces).toBe(-1);
    expect(business.storageGb).toBe(-1);
    expect(business.brands).toBe(PLANS.business.limits.brands);
  });

  it('carries storage and API throughput through untouched — no add-on affects them', () => {
    const starter = resolveLimits(record({ tier: 'starter', addonBrands: 3, addonSeats: 2 }));
    expect(starter.storageGb).toBe(PLANS.starter.limits.storageGb);
    expect(starter.apiRequestsPerMinute).toBe(PLANS.starter.limits.apiRequestsPerMinute);

    // Free (no subscription) meters 1 GB and has no API access.
    expect(resolveLimits(null).storageGb).toBe(1);
    expect(resolveLimits(null).apiRequestsPerMinute).toBe(0);
  });

  it('ignores negative or missing add-on quantities', () => {
    const negative = resolveLimits(record({ tier: 'pro', addonBrands: -2, addonSeats: -1 }));
    expect(negative.brands).toBe(PLANS.pro.limits.brands);
    expect(negative.teamMembers).toBe(PLANS.pro.limits.teamMembers);

    const absent = resolveLimits(record({ tier: 'starter' }));
    expect(absent.brands).toBe(PLANS.starter.limits.brands);
  });

  it('meters posts on free only; every paid tier is unlimited', () => {
    expect(resolveLimits(null).postsPerMonth).toBe(PLANS.free.limits.postsPerMonth);
    for (const tier of ['starter', 'pro', 'business'] as const) {
      expect(resolveLimits(record({ tier })).postsPerMonth).toBe(-1);
    }
  });
});

describe('hasFeature', () => {
  it('gates smart scheduling to Pro and Business, active records only', () => {
    expect(hasFeature(record({ tier: 'pro' }), 'smartScheduling')).toBe(true);
    expect(hasFeature(record({ tier: 'business' }), 'smartScheduling')).toBe(true);
    expect(hasFeature(record({ tier: 'starter' }), 'smartScheduling')).toBe(false);
    expect(hasFeature(record({ tier: 'pro', status: 'canceled' }), 'smartScheduling')).toBe(false);
    expect(hasFeature(null, 'smartScheduling')).toBe(false);
  });

  it('gates CSV export to Business', () => {
    expect(hasFeature(record({ tier: 'business' }), 'analyticsCsvExport')).toBe(true);
    expect(hasFeature(record({ tier: 'pro' }), 'analyticsCsvExport')).toBe(false);
  });
});
