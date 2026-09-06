import { describe, expect, it } from 'vitest';
import { ALL_BRANDS_VALUE, isAllBrandsSelection, resolveBrandSelection } from '../brand-selection';

const products = [{ id: 'prod_1' }, { id: 'prod_2' }];

describe('resolveBrandSelection', () => {
  it('preserves the all-brands sentinel (the bug that downgraded it to one brand)', () => {
    // Regression: choosing "All brands" must NOT fall back to products[0].
    expect(resolveBrandSelection(ALL_BRANDS_VALUE, products)).toBe(ALL_BRANDS_VALUE);
    expect(isAllBrandsSelection(resolveBrandSelection(ALL_BRANDS_VALUE, products))).toBe(true);
  });

  it('keeps a real chosen brand', () => {
    expect(resolveBrandSelection('prod_2', products)).toBe('prod_2');
  });

  it('defaults to the first brand when nothing is chosen', () => {
    expect(resolveBrandSelection(null, products)).toBe('prod_1');
    expect(resolveBrandSelection(undefined, products)).toBe('prod_1');
  });

  it('ignores a stale chosen id that is not among the loaded products', () => {
    expect(resolveBrandSelection('prod_gone', products)).toBe('prod_1');
  });

  it('returns empty string when there are no products and no sentinel', () => {
    expect(resolveBrandSelection(null, [])).toBe('');
    // The sentinel still survives even with no products loaded.
    expect(resolveBrandSelection(ALL_BRANDS_VALUE, [])).toBe(ALL_BRANDS_VALUE);
  });
});
