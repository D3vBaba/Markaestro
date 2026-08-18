import { describe, expect, it } from 'vitest';
import { hasPublicApiScope, requireApiClientProduct, tierScaledRateLimits } from '../public-api/auth';
import type { PublicApiScope } from '../public-api/scopes';
import { RATE_LIMITS } from '../rate-limit';
import { PLANS } from '../stripe/plans';

describe('public API scope checks', () => {
  it('allows explicit scope grants', () => {
    const scopes: PublicApiScope[] = ['products.read'];
    expect(hasPublicApiScope(scopes, 'products.read')).toBe(true);
  });

  it('allows product discovery for publish-capable keys', () => {
    expect(hasPublicApiScope(['posts.write'], 'products.read')).toBe(true);
    expect(hasPublicApiScope(['posts.publish'], 'products.read')).toBe(true);
  });

  it('does not broaden unrelated scopes', () => {
    expect(hasPublicApiScope(['media.write'], 'products.read')).toBe(false);
    expect(hasPublicApiScope(['products.read'], 'webhooks.manage')).toBe(false);
  });
});

describe('tier-scaled rate limits', () => {
  it('runs Starter at the 1x baseline (60/min per route, 240/min global)', () => {
    const { route, global } = tierScaledRateLimits(
      RATE_LIMITS.api,
      PLANS.starter.limits.apiRequestsPerMinute,
    );
    expect(route).toEqual({ limit: 60, windowMs: 60_000 });
    expect(global).toEqual({ limit: 240, windowMs: 60_000 });
  });

  it('doubles Pro and 5x-es Business on route and global budgets alike', () => {
    const pro = tierScaledRateLimits(RATE_LIMITS.api, PLANS.pro.limits.apiRequestsPerMinute);
    expect(pro.route.limit).toBe(120);
    expect(pro.global.limit).toBe(480);

    const business = tierScaledRateLimits(RATE_LIMITS.api, PLANS.business.limits.apiRequestsPerMinute);
    expect(business.route.limit).toBe(300);
    expect(business.global.limit).toBe(1_200);
  });

  it('scales custom per-route configs while the global floor tracks the tier', () => {
    const mediaConfig = { limit: 20, windowMs: 60_000 };

    const starter = tierScaledRateLimits(mediaConfig, PLANS.starter.limits.apiRequestsPerMinute);
    expect(starter.route.limit).toBe(20);
    expect(starter.global.limit).toBe(240); // floor wins over 20 * 4

    const business = tierScaledRateLimits(mediaConfig, PLANS.business.limits.apiRequestsPerMinute);
    expect(business.route.limit).toBe(100);
    expect(business.global.limit).toBe(1_200); // scaled floor wins over 100 * 4
  });

  it('keeps the 1x baseline instead of locking out tiers without API throughput', () => {
    // An active subscription with an unmapped Stripe price resolves to
    // 'free' (0 req/min); the key stays usable at the Starter baseline.
    const fallback = tierScaledRateLimits(RATE_LIMITS.api, PLANS.free.limits.apiRequestsPerMinute);
    expect(fallback.route.limit).toBe(60);
    expect(fallback.global.limit).toBe(240);
  });
});

describe('API key product binding', () => {
  it('returns the bound product id, trimmed', () => {
    expect(requireApiClientProduct('prod_123')).toBe('prod_123');
    expect(requireApiClientProduct('  prod_123  ')).toBe('prod_123');
  });

  it('refuses keys with no binding — including legacy keys missing the field', () => {
    for (const value of [undefined, null, '', '   ']) {
      expect(() => requireApiClientProduct(value)).toThrow();
    }
  });

  it('refuses with a 403 and an actionable code rather than a generic error', async () => {
    try {
      requireApiClientProduct(undefined);
      throw new Error('should have refused');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      const res = thrown as Response;
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'API_KEY_NOT_BOUND_TO_PRODUCT' });
    }
  });
});
