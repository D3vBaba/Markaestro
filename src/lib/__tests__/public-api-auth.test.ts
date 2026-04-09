import { describe, expect, it } from 'vitest';
import { hasPublicApiScope } from '../public-api/auth';
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
