import { describe, expect, it } from 'vitest';
import { hasPublicApiScope, requireApiClientProduct } from '../public-api/auth';
import type { PublicApiScope } from '../public-api/scopes';

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
