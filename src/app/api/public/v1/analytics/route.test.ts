import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS } from '@/lib/stripe/plans';

const requirePublicApiContextMock = vi.fn();
const buildAnalyticsResponseMock = vi.fn();

vi.mock('@/lib/public-api/auth', () => ({
  requirePublicApiContext: requirePublicApiContextMock,
}));

vi.mock('@/lib/analytics/query', () => ({
  buildAnalyticsResponse: buildAnalyticsResponseMock,
  fetchPostRowsForExport: vi.fn(),
  postToRow: vi.fn(),
  resolveWindow: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));

function call(query = '') {
  return import('./route').then(({ GET }) => GET(new Request(`http://localhost/api/public/v1/analytics${query}`)));
}

function context(planTier: string) {
  return {
    principalType: 'api_client',
    workspaceId: 'ws_1',
    clientId: 'cli_1',
    productId: 'prod_1',
    planTier,
    rateLimitHeaders: { 'X-RateLimit-Limit': '20' },
  };
}

describe('GET /api/public/v1/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePublicApiContextMock.mockResolvedValue(context('starter'));
    buildAnalyticsResponseMock.mockResolvedValue({ totals: { posts: 3 } });
  });

  it('requires analytics.read and pins the query to the key’s brand', async () => {
    const response = await call('?days=7&channel=instagram&tz=-120');

    expect(response.status).toBe(200);
    expect(requirePublicApiContextMock).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ scope: 'analytics.read', rateLimit: expect.objectContaining({ limit: 20 }) }),
    );
    expect(buildAnalyticsResponseMock).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      productId: 'prod_1',
      days: 7,
      requestedDays: 7,
      channel: 'instagram',
      tzOffsetMinutes: -120,
      tier: 'starter',
    }));
    expect(await response.json()).toEqual({ analytics: { totals: { posts: 3 } } });
    expect(response.headers.get('X-RateLimit-Limit')).toBe('20');
  });

  it('clamps the window to the plan’s history and reports the cap', async () => {
    const cap = PLANS.starter.limits.analyticsWindowDays;
    expect(cap).toBeGreaterThan(0);

    await call('?days=365');

    expect(buildAnalyticsResponseMock).toHaveBeenCalledWith(expect.objectContaining({
      days: Math.min(365, cap),
      requestedDays: 365,
      maxDays: cap,
    }));
  });

  it('leaves an unlimited plan unclamped', async () => {
    requirePublicApiContextMock.mockResolvedValue(context('business'));
    expect(PLANS.business.limits.analyticsWindowDays).toBe(-1);

    await call('?days=365');

    expect(buildAnalyticsResponseMock).toHaveBeenCalledWith(expect.objectContaining({ days: 365, maxDays: -1 }));
  });

  it('passes an explicit range through and defaults the rest', async () => {
    await call('?since=2026-08-01&until=2026-08-31');

    expect(buildAnalyticsResponseMock).toHaveBeenCalledWith(expect.objectContaining({
      since: '2026-08-01',
      until: '2026-08-31',
      requestedDays: 28,
      channel: undefined,
      tzOffsetMinutes: 0,
    }));
  });

  it('rejects an unknown channel before reading anything', async () => {
    const response = await call('?channel=myspace');

    expect(response.status).toBe(400);
    expect(buildAnalyticsResponseMock).not.toHaveBeenCalled();
  });

  it('answers 403 from the scope check as-is', async () => {
    requirePublicApiContextMock.mockRejectedValue(new Error('FORBIDDEN'));

    const response = await call();

    expect(response.status).toBe(403);
    expect(buildAnalyticsResponseMock).not.toHaveBeenCalled();
  });
});
