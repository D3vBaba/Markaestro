import { describe, expect, it } from 'vitest';
import {
  isActiveSubscription,
  effectiveTier,
  pickEffectiveSubscription,
} from '../stripe/subscription';
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

describe('isActiveSubscription', () => {
  it('treats active and trialing as active', () => {
    expect(isActiveSubscription(record({ status: 'active' }))).toBe(true);
    expect(isActiveSubscription(record({ status: 'trialing' }))).toBe(true);
  });

  it('treats lapsed and missing records as inactive', () => {
    for (const status of ['canceled', 'past_due', 'unpaid', 'incomplete', 'paused']) {
      expect(isActiveSubscription(record({ status }))).toBe(false);
    }
    expect(isActiveSubscription(null)).toBe(false);
    expect(isActiveSubscription(undefined)).toBe(false);
  });
});

describe('effectiveTier', () => {
  it('returns the tier of an active subscription', () => {
    expect(effectiveTier(record({ tier: 'business' }))).toBe('business');
    expect(effectiveTier(record({ tier: 'pro', status: 'trialing' }))).toBe('pro');
  });

  it('downgrades lapsed subscriptions to starter regardless of stored tier', () => {
    expect(effectiveTier(record({ tier: 'business', status: 'canceled' }))).toBe('starter');
    expect(effectiveTier(record({ tier: 'pro', status: 'past_due' }))).toBe('starter');
  });

  it('treats unrecognized tiers as starter', () => {
    expect(effectiveTier(record({ tier: 'unknown' }))).toBe('starter');
    expect(effectiveTier(record({ tier: '' }))).toBe('starter');
  });

  it('returns starter when there is no record', () => {
    expect(effectiveTier(null)).toBe('starter');
    expect(effectiveTier(undefined)).toBe('starter');
  });
});

describe('pickEffectiveSubscription', () => {
  it('prefers the higher active tier between account and workspace', () => {
    const account = record({ tier: 'starter' });
    const workspace = record({ tier: 'business' });
    // A comped starter must NOT downgrade a member inside a business workspace.
    expect(pickEffectiveSubscription(account, workspace)).toBe(workspace);
    // ...and a business comp lifts the user above a starter workspace.
    const bizAccount = record({ tier: 'business' });
    const starterWs = record({ tier: 'starter' });
    expect(pickEffectiveSubscription(bizAccount, starterWs)).toBe(bizAccount);
  });

  it('workspace wins ties between equal active tiers', () => {
    const account = record({ tier: 'pro' });
    const workspace = record({ tier: 'pro' });
    expect(pickEffectiveSubscription(account, workspace)).toBe(workspace);
  });

  it('an inactive account record never shadows an active workspace subscription', () => {
    const account = record({ tier: 'business', status: 'canceled' });
    const workspace = record({ tier: 'pro' });
    expect(pickEffectiveSubscription(account, workspace)).toBe(workspace);
  });

  it('an inactive workspace record never shadows an active account entitlement', () => {
    const account = record({ tier: 'pro' });
    const workspace = record({ tier: 'business', status: 'canceled' });
    expect(pickEffectiveSubscription(account, workspace)).toBe(account);
  });

  it('surfaces the workspace record (then account) when nothing is active, for status display', () => {
    const account = record({ tier: 'pro', status: 'canceled' });
    const workspace = record({ tier: 'business', status: 'canceled' });
    expect(pickEffectiveSubscription(account, workspace)).toBe(workspace);
    expect(pickEffectiveSubscription(account, null)).toBe(account);
    expect(pickEffectiveSubscription(null, null)).toBeNull();
  });

  it('lapsed records surface for history but entitle nothing', () => {
    const surfaced = pickEffectiveSubscription(record({ tier: 'business', status: 'canceled' }), null);
    expect(surfaced).not.toBeNull();
    expect(effectiveTier(surfaced)).toBe('starter');
  });
});
