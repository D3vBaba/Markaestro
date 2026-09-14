import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubscriptionRecord } from '../stripe/server';

const mocks = vi.hoisted(() => ({ subscription: vi.fn(), owner: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { doc: () => ({ get: mocks.owner }) },
}));
vi.mock('@/lib/stripe/subscription', async (importOriginal) => ({
  ...await importOriginal<typeof import('../stripe/subscription')>(),
  getEffectiveSubscription: mocks.subscription,
}));

import { checkAndIncrementUsage } from '../usage';
import { requirePaidPublishing } from '../stripe/publishing-access';
import { effectiveTier, resolveStatus } from '../stripe/subscription';

const trial = {
  tier: 'growth', status: 'trialing', trialEnd: '2026-09-20T12:00:00Z',
  stripeCustomerId: 'cus_test', stripeSubscriptionId: 'sub_test',
  stripePriceId: 'price_test', interval: 'monthly', currentPeriodEnd: null,
  cancelAtPeriodEnd: false, updatedAt: '2026-09-13T12:00:00Z',
} satisfies SubscriptionRecord;

describe('paid-only publishing', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));
    mocks.subscription.mockReset();
    mocks.owner.mockReset().mockResolvedValue({ data: () => ({ createdBy: 'owner' }) });
  });

  it('rejects unpaid creation and queued publishing, even with saved content', async () => {
    mocks.subscription.mockResolvedValue(null);
    await expect(checkAndIncrementUsage('owner', 'posts', 'ws')).resolves.toMatchObject({
      allowed: false, reason: 'subscription_required', limit: 0,
    });
    await expect(requirePaidPublishing('ws')).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  });

  it('allows a Growth trial and stops it at expiry even before a webhook arrives', async () => {
    mocks.subscription.mockResolvedValue(trial);
    await expect(requirePaidPublishing('ws', 'owner')).resolves.toBeUndefined();
    await expect(checkAndIncrementUsage('owner', 'posts', 'ws')).resolves.toMatchObject({ allowed: true });
    vi.setSystemTime(new Date(trial.trialEnd));
    expect(effectiveTier(trial)).toBe('free');
    expect(resolveStatus(trial)).toMatchObject({ active: false, trialing: false });
    await expect(requirePaidPublishing('ws', 'owner')).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  });

  it('honors owner review grants for background publishing', async () => {
    mocks.subscription.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...trial, status: 'active' });
    await expect(requirePaidPublishing('ws')).resolves.toBeUndefined();
    expect(mocks.subscription).toHaveBeenLastCalledWith({ workspaceId: 'ws', uid: 'owner' });
  });
});
