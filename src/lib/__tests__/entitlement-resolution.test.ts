import { describe, expect, it } from 'vitest';
import {
  isActiveSubscription,
  effectiveTier,
  legacySubscriptionAppliesToWorkspace,
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

  it('downgrades lapsed subscriptions to free regardless of stored tier', () => {
    expect(effectiveTier(record({ tier: 'business', status: 'canceled' }))).toBe('free');
    expect(effectiveTier(record({ tier: 'pro', status: 'past_due' }))).toBe('free');
  });

  it('treats unrecognized tiers as free', () => {
    expect(effectiveTier(record({ tier: 'unknown' }))).toBe('free');
    expect(effectiveTier(record({ tier: '' }))).toBe('free');
  });

  it('returns free when there is no record', () => {
    expect(effectiveTier(null)).toBe('free');
    expect(effectiveTier(undefined)).toBe('free');
  });

  it('never entitles the free tier through an active record claiming it', () => {
    // 'free' is not purchasable; a record that somehow stores it still
    // resolves to free rather than crashing or granting anything higher.
    expect(effectiveTier(record({ tier: 'free' }))).toBe('free');
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

  it('ranks every paid tier above free/unrecognized records', () => {
    // tierRank ordering: business > pro > starter > (free / unknown).
    const starter = record({ tier: 'starter' });
    const freeish = record({ tier: 'free' });
    const unknown = record({ tier: 'unknown' });
    expect(pickEffectiveSubscription(freeish, starter)).toBe(starter);
    expect(pickEffectiveSubscription(starter, unknown)).toBe(starter);
    const pro = record({ tier: 'pro' });
    const business = record({ tier: 'business' });
    expect(pickEffectiveSubscription(starter, pro)).toBe(pro);
    expect(pickEffectiveSubscription(business, pro)).toBe(business);
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
    expect(effectiveTier(surfaced)).toBe('free');
  });
});

describe('legacySubscriptionAppliesToWorkspace', () => {
  it('keeps an unmigrated paid subscription active in its owner workspace', () => {
    const legacy = record({ tier: 'pro', workspaceId: undefined });
    expect(legacySubscriptionAppliesToWorkspace(legacy, 'user-1', 'default', 'user-1')).toBe(true);
  });

  it('never carries a legacy subscription into another user or team workspace', () => {
    const legacy = record({ tier: 'pro', workspaceId: undefined });
    expect(legacySubscriptionAppliesToWorkspace(legacy, 'user-1', 'team-1', 'user-2')).toBe(false);
    expect(legacySubscriptionAppliesToWorkspace(
      record({ workspaceId: 'personal-1' }),
      'user-1',
      'team-1',
      'user-1',
    )).toBe(false);
  });
});
