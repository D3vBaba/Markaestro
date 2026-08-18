import { describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  data: {
    completed: true,
    hasProducts: true,
    hasSubscriptionHistory: true,
    subscriptionStatus: {
      active: true,
      hasSubscriptionHistory: true,
      tier: 'pro',
      interval: 'month',
      trialing: false,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    },
  },
}));

vi.mock('@/lib/api-client', () => ({
  apiFetch: apiFetchMock,
}));

describe('app bootstrap client', () => {
  it('shares one in-flight request between shell consumers', async () => {
    const { fetchAppBootstrap } = await import('../app-bootstrap-client');
    const [subscription, onboarding] = await Promise.all([
      fetchAppBootstrap('ws_1'),
      fetchAppBootstrap('ws_1'),
    ]);

    expect(subscription).toEqual(onboarding);
    expect(apiFetchMock).toHaveBeenCalledOnce();
    expect(apiFetchMock).toHaveBeenCalledWith('/api/onboarding/status?workspaceId=ws_1');
  });
});
