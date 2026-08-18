import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubscriptionRecord } from '@/lib/stripe/server';

const requireContextMock = vi.fn();
const getSubscriptionMock = vi.fn();
const upsertSubscriptionMock = vi.fn();
const priceIdForPlanMock = vi.fn();
const tierFromPriceIdMock = vi.fn();
const stripeRetrieveMock = vi.fn();
const stripeUpdateMock = vi.fn();
const countGetMock = vi.fn();

vi.mock('@/lib/server-auth', () => ({
  requireContext: requireContextMock,
}));

vi.mock('@/lib/stripe/subscription', () => ({
  getSubscriptionForWorkspace: getSubscriptionMock,
  upsertSubscriptionForWorkspace: upsertSubscriptionMock,
}));

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({
    subscriptions: { retrieve: stripeRetrieveMock, update: stripeUpdateMock },
  }),
  // Real behavior: only genuine `cus_` ids count (manual comps store placeholders).
  hasStripeCustomer: (sub: { stripeCustomerId?: string } | null | undefined) =>
    Boolean(sub?.stripeCustomerId?.startsWith('cus_')),
  priceIdForPlan: priceIdForPlanMock,
  tierFromPriceId: tierFromPriceIdMock,
}));

// Aggregate counts, keyed by collection path (collectionGroup uses 'group:members').
let counts: Record<string, number>;

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (path: string) => ({
      count: () => ({ get: () => countGetMock(path) }),
    }),
    collectionGroup: (name: string) => ({
      where: () => ({
        where: () => ({
          count: () => ({ get: () => countGetMock(`group:${name}`) }),
        }),
      }),
    }),
  },
}));

const ctx = {
  uid: 'user_1',
  email: 'owner@example.com',
  workspaceId: 'ws_1',
  role: 'owner' as const,
  emailVerified: true,
};

const PRICE_MAP: Record<string, { tier: string; interval: string }> = {};
for (const tier of ['starter', 'pro', 'business']) {
  for (const interval of ['monthly', 'annual']) {
    PRICE_MAP[`price_${tier}_${interval}`] = { tier, interval };
  }
}

function makeSub(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    workspaceId: 'ws_1',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    stripePriceId: 'price_pro_monthly',
    tier: 'pro',
    interval: 'monthly',
    status: 'active',
    trialEnd: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    addonBrands: 0,
    addonSeats: 0,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function request(body: unknown) {
  return new Request('http://localhost/api/stripe/change-plan', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function post(body: unknown) {
  const { POST } = await import('./route');
  return POST(request(body));
}

beforeEach(() => {
  vi.clearAllMocks();
  requireContextMock.mockResolvedValue(ctx);
  getSubscriptionMock.mockResolvedValue(makeSub());
  upsertSubscriptionMock.mockResolvedValue(undefined);
  priceIdForPlanMock.mockImplementation((tier: string, interval: string) => `price_${tier}_${interval}`);
  tierFromPriceIdMock.mockImplementation((id: string) => PRICE_MAP[id] ?? null);
  stripeRetrieveMock.mockResolvedValue({
    id: 'sub_123',
    items: {
      data: [
        { id: 'si_addon', price: { id: 'price_addon_brand_monthly' } },
        { id: 'si_base', price: { id: 'price_pro_monthly' } },
      ],
    },
  });
  stripeUpdateMock.mockResolvedValue({});
  counts = { products: 0, members: 1, pendingInvites: 0, 'group:members': 1 };
  countGetMock.mockImplementation((path: string) => {
    const key = path.startsWith('group:') ? path : path.split('/').pop()!;
    return Promise.resolve({ data: () => ({ count: counts[key] ?? 0 }) });
  });
});

describe('POST /api/stripe/change-plan — auth & validation', () => {
  it('requires authentication', async () => {
    requireContextMock.mockRejectedValue(new Error('UNAUTHENTICATED'));
    const res = await post({ tier: 'pro', interval: 'monthly' });
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error).toBe('UNAUTHENTICATED');
  });

  it('forbids non-owners (billing.manage is owner-only)', async () => {
    requireContextMock.mockResolvedValue({ ...ctx, role: 'admin' });
    const res = await post({ tier: 'business', interval: 'monthly' });
    expect(res.status).toBe(403);
    expect(stripeUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid tier (including free) with 400', async () => {
    expect((await post({ tier: 'free', interval: 'monthly' })).status).toBe(400);
    expect((await post({ tier: 'mega', interval: 'monthly' })).status).toBe(400);
  });

  it('rejects an invalid interval with 400', async () => {
    const res = await post({ tier: 'pro', interval: 'weekly' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/stripe/change-plan — billing account gating', () => {
  it.each([
    ['no subscription record', null],
    ['lapsed subscription', makeSub({ status: 'canceled' })],
    ['manual comp customer id', makeSub({ stripeCustomerId: 'manual_grant_user_1' })],
    ['non-Stripe subscription id', makeSub({ stripeSubscriptionId: 'manual_grant_user_1' })],
  ])('returns 404 NO_BILLING_ACCOUNT for %s', async (_label, sub) => {
    getSubscriptionMock.mockResolvedValue(sub);
    const res = await post({ tier: 'business', interval: 'monthly' });
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toBe('NO_BILLING_ACCOUNT');
    expect(stripeUpdateMock).not.toHaveBeenCalled();
  });

  it('returns 400 ALREADY_ON_PLAN for the current tier + interval', async () => {
    const res = await post({ tier: 'pro', interval: 'monthly' });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('ALREADY_ON_PLAN');
  });
});

describe('POST /api/stripe/change-plan — add-on compatibility', () => {
  it('blocks a downgrade that would strand seat add-ons', async () => {
    getSubscriptionMock.mockResolvedValue(makeSub({ addonSeats: 2 }));
    const res = await post({ tier: 'starter', interval: 'monthly' });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toBe('ADDONS_NOT_AVAILABLE_ON_TIER');
    expect(body.addons).toEqual(['seat']);
    expect(stripeUpdateMock).not.toHaveBeenCalled();
  });

  it('blocks an upgrade to business while brand add-ons are held', async () => {
    getSubscriptionMock.mockResolvedValue(makeSub({ addonBrands: 1 }));
    const res = await post({ tier: 'business', interval: 'monthly' });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.addons).toEqual(['brand']);
  });

  it('lists every stranded add-on', async () => {
    // Business supports neither add-on, so both block the switch.
    getSubscriptionMock.mockResolvedValue(makeSub({ addonBrands: 1, addonSeats: 3 }));
    const res = await post({ tier: 'business', interval: 'monthly' });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.addons).toEqual(['brand', 'seat']);
  });
});

describe('POST /api/stripe/change-plan — downgrade usage guard', () => {
  it('blocks a downgrade listing only the exceeded dimensions', async () => {
    getSubscriptionMock.mockResolvedValue(makeSub({ tier: 'business', stripePriceId: 'price_business_monthly' }));
    // Pro allows 6 brands / 5 team members / 5 workspaces.
    counts = { products: 8, members: 4, pendingInvites: 2, 'group:members': 3 };
    const res = await post({ tier: 'pro', interval: 'monthly' });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toBe('PLAN_DOWNGRADE_BLOCKED');
    expect(body.details).toEqual({
      brands: { current: 8, allowed: 6 },
      // Pending invites count toward the seat cap, matching POST /api/team.
      teamMembers: { current: 6, allowed: 5 },
    });
    expect(body.details.workspaces).toBeUndefined();
    expect(stripeUpdateMock).not.toHaveBeenCalled();
  });

  it('counts owned workspaces against the target workspace limit', async () => {
    getSubscriptionMock.mockResolvedValue(makeSub());
    counts = { products: 1, members: 1, pendingInvites: 0, 'group:members': 4 };
    const res = await post({ tier: 'starter', interval: 'monthly' });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.details).toEqual({ workspaces: { current: 4, allowed: 1 } });
  });

  it('raises the target brand limit by surviving brand add-ons', async () => {
    getSubscriptionMock.mockResolvedValue(makeSub({ addonBrands: 2 }));
    // Starter base is 2 brands; +2 add-on brands = 4 allowed.
    counts = { products: 4, members: 1, pendingInvites: 0, 'group:members': 1 };
    const res = await post({ tier: 'starter', interval: 'monthly' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('skips usage counting on upgrades', async () => {
    getSubscriptionMock.mockResolvedValue(makeSub({ tier: 'starter', stripePriceId: 'price_starter_monthly' }));
    stripeRetrieveMock.mockResolvedValue({
      id: 'sub_123',
      items: { data: [{ id: 'si_base', price: { id: 'price_starter_monthly' } }] },
    });
    counts = { products: 50, members: 50, pendingInvites: 0, 'group:members': 50 };
    const res = await post({ tier: 'pro', interval: 'monthly' });
    expect(res.status).toBe(200);
    expect(countGetMock).not.toHaveBeenCalled();
  });

  it('skips the guard on a pure interval switch', async () => {
    const res = await post({ tier: 'pro', interval: 'annual' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, tier: 'pro', interval: 'annual' });
    expect(countGetMock).not.toHaveBeenCalled();
    expect(stripeUpdateMock).toHaveBeenCalledWith('sub_123', expect.objectContaining({
      items: [{ id: 'si_base', price: 'price_pro_annual' }],
    }));
  });
});

describe('POST /api/stripe/change-plan — Stripe update', () => {
  it('swaps only the base plan item and writes the optimistic record', async () => {
    const res = await post({ tier: 'business', interval: 'annual' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, tier: 'business', interval: 'annual' });
    expect(stripeUpdateMock).toHaveBeenCalledWith('sub_123', {
      items: [{ id: 'si_base', price: 'price_business_annual' }],
      proration_behavior: 'create_prorations',
      cancel_at_period_end: false,
    });
    expect(upsertSubscriptionMock).toHaveBeenCalledWith('ws_1', {
      tier: 'business',
      interval: 'annual',
      stripePriceId: 'price_business_annual',
      cancelAtPeriodEnd: false,
    });
  });

  it('returns 500 when the target price is not configured', async () => {
    priceIdForPlanMock.mockReturnValue(null);
    const res = await post({ tier: 'business', interval: 'annual' });
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe('Price not configured');
    expect(stripeUpdateMock).not.toHaveBeenCalled();
  });

  it('returns 500 when no subscription item maps to a plan tier', async () => {
    stripeRetrieveMock.mockResolvedValue({
      id: 'sub_123',
      items: { data: [{ id: 'si_addon', price: { id: 'price_addon_brand_monthly' } }] },
    });
    const res = await post({ tier: 'business', interval: 'monthly' });
    expect(res.status).toBe(500);
    expect(stripeUpdateMock).not.toHaveBeenCalled();
  });

  it('maps unexpected Stripe failures to a 500 without an optimistic write', async () => {
    stripeUpdateMock.mockRejectedValue(new Error('stripe down'));
    const res = await post({ tier: 'business', interval: 'monthly' });
    expect(res.status).toBe(500);
    expect(upsertSubscriptionMock).not.toHaveBeenCalled();
  });
});
