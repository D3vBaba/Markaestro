import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireContextMock = vi.fn();
const requirePermissionMock = vi.fn();
const getSubscriptionMock = vi.fn();
const resolvePlanPriceMock = vi.fn();
const stripeCustomersListMock = vi.fn();
const stripeCustomersCreateMock = vi.fn();
const stripeSubscriptionsListMock = vi.fn();
const stripeCheckoutCreateMock = vi.fn();
const stripePortalCreateMock = vi.fn();

vi.mock('@/lib/server-auth', () => ({
  requireContext: requireContextMock,
}));

vi.mock('@/lib/rbac', () => ({
  requirePermission: requirePermissionMock,
}));

vi.mock('@/lib/stripe/subscription', () => ({
  getSubscriptionForWorkspace: getSubscriptionMock,
}));

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({
    customers: {
      list: stripeCustomersListMock,
      create: stripeCustomersCreateMock,
      update: vi.fn(),
    },
    subscriptions: {
      list: stripeSubscriptionsListMock,
    },
    checkout: {
      sessions: {
        create: stripeCheckoutCreateMock,
      },
    },
    billingPortal: {
      sessions: {
        create: stripePortalCreateMock,
      },
    },
  }),
  hasStripeCustomer: (sub: { stripeCustomerId?: string } | null | undefined) =>
    Boolean(sub?.stripeCustomerId?.startsWith('cus_')),
  resolvePlanPrice: resolvePlanPriceMock,
}));

const ctx = {
  uid: 'user_1',
  email: 'owner@example.com',
  workspaceId: 'ws_1',
  role: 'owner' as const,
  emailVerified: true,
};

describe('POST /api/stripe/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireContextMock.mockResolvedValue(ctx);
    requirePermissionMock.mockReturnValue(undefined);
    getSubscriptionMock.mockResolvedValue(null);
    resolvePlanPriceMock.mockImplementation(async (_stripe: unknown, tier: string, interval: string) => ({
      ok: true,
      priceId: `price_${tier}_${interval}`,
      substituted: false,
    }));
    stripeCustomersListMock.mockResolvedValue({ data: [] });
    stripeCustomersCreateMock.mockResolvedValue({ id: 'cus_new' });
    stripeSubscriptionsListMock.mockResolvedValue({ data: [] });
    stripeCheckoutCreateMock.mockResolvedValue({ url: 'https://checkout.stripe.com/session_1' });
    stripePortalCreateMock.mockResolvedValue({ url: 'https://billing.stripe.com/portal_1' });
  });

  async function post(body: unknown) {
    const { POST } = await import('./route');
    const req = new Request('https://markaestro.com/api/stripe/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return POST(req);
  }

  it('rejects unauthenticated requests', async () => {
    requireContextMock.mockRejectedValue(new Error('UNAUTHENTICATED'));
    const res = await post({ tier: 'starter', interval: 'monthly' });
    expect(res.status).toBe(401);
  });

  it('rejects unauthorized roles (non-owner)', async () => {
    requirePermissionMock.mockImplementation(() => {
      throw new Error('FORBIDDEN');
    });
    const res = await post({ tier: 'starter', interval: 'monthly' });
    expect(res.status).toBe(403);
  });

  it('rejects invalid tiers', async () => {
    const res = await post({ tier: 'invalid_tier', interval: 'monthly' });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid tier');
  });

  it('rejects invalid intervals', async () => {
    const res = await post({ tier: 'starter', interval: 'weekly' });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid interval');
  });

  it('returns 500 if price is not configured', async () => {
    resolvePlanPriceMock.mockResolvedValue({ ok: false, reason: 'NOT_CONFIGURED' });
    const res = await post({ tier: 'starter', interval: 'monthly' });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Price not configured');
  });

  it('creates checkout session for new subscribers on valid tier', async () => {
    const res = await post({ tier: 'pro', interval: 'annual' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toBe('https://checkout.stripe.com/session_1');
    expect(stripeCheckoutCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: 'price_pro_annual', quantity: 1 }],
      }),
      expect.any(Object),
    );
  });

  describe('return destination', () => {
    function urlsFromLastSession() {
      const [args] = stripeCheckoutCreateMock.mock.calls.at(-1)!;
      return { success: args.success_url as string, cancel: args.cancel_url as string };
    }

    it('returns to the page checkout started from', async () => {
      await post({ tier: 'pro', interval: 'annual', returnTo: '/settings?tab=billing' });
      const { success, cancel } = urlsFromLastSession();
      expect(cancel).toMatch(/\/settings\?tab=billing$/);
      expect(success).toContain(`next=${encodeURIComponent('/settings?tab=billing')}`);
    });

    it('falls back to onboarding when no origin is named', async () => {
      await post({ tier: 'pro', interval: 'annual' });
      const { cancel } = urlsFromLastSession();
      expect(cancel).toMatch(/\/onboarding$/);
    });

    // Cancelling mid-onboarding belongs back on the paywall; paying moves on.
    it('sends a completed onboarding purchase to the dashboard, not back to the funnel', async () => {
      await post({ tier: 'pro', interval: 'annual', returnTo: '/onboarding' });
      const { success, cancel } = urlsFromLastSession();
      expect(cancel).toMatch(/\/onboarding$/);
      expect(success).toContain(`next=${encodeURIComponent('/dashboard')}`);
    });

    it('refuses an off-site return target', async () => {
      await post({ tier: 'pro', interval: 'annual', returnTo: 'https://evil.example/steal' });
      expect(urlsFromLastSession().cancel).toMatch(/\/onboarding$/);

      await post({ tier: 'pro', interval: 'annual', returnTo: '//evil.example' });
      expect(urlsFromLastSession().cancel).toMatch(/\/onboarding$/);
    });

    it('returns the billing portal to the originating page too', async () => {
      getSubscriptionMock.mockResolvedValue({
        stripeCustomerId: 'cus_existing',
        stripeSubscriptionId: 'sub_existing',
        status: 'active',
      });
      await post({ tier: 'business', interval: 'monthly', returnTo: '/settings?tab=billing' });
      expect(stripePortalCreateMock).toHaveBeenCalledWith({
        customer: 'cus_existing',
        return_url: expect.stringContaining('/settings?tab=billing'),
      });
    });
  });

  it('redirects existing active subscriber to billing portal', async () => {
    getSubscriptionMock.mockResolvedValue({
      stripeCustomerId: 'cus_existing',
      stripeSubscriptionId: 'sub_existing',
      status: 'active',
    });

    const res = await post({ tier: 'business', interval: 'monthly' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toBe('https://billing.stripe.com/portal_1');
    expect(stripePortalCreateMock).toHaveBeenCalledWith({
      customer: 'cus_existing',
      return_url: expect.stringContaining('/settings'),
    });
  });
});
