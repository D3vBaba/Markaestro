/**
 * Brand selection shared by the agent consent page (and mirrored by the
 * Settings create-key dialog): the value a brand <select> can hold is either a
 * real product id or the all-brands sentinel below.
 */

/**
 * Sentinel for "every brand in the workspace" (a sitewide grant). It is
 * deliberately not a valid product id, so it can never collide with one; the
 * caller turns it into `allBrands: true` on the wire.
 */
export const ALL_BRANDS_VALUE = '__all_brands__';

/**
 * Resolve the effective brand-select value from the user's pick and the loaded
 * products. The all-brands sentinel MUST survive: an earlier version tested the
 * pick against the product list and, because the sentinel is not a real
 * product, fell back to the first brand, so choosing "All brands" silently
 * minted a single-brand key. The sentinel is checked first here to prevent
 * exactly that.
 */
export function resolveBrandSelection(
  chosen: string | null | undefined,
  products: ReadonlyArray<{ id: string }>,
): string {
  if (chosen === ALL_BRANDS_VALUE) return ALL_BRANDS_VALUE;
  if (chosen && products.some((p) => p.id === chosen)) return chosen;
  return products[0]?.id ?? '';
}

/** Whether a resolved selection means an all-brands (sitewide) grant. */
export function isAllBrandsSelection(value: string): boolean {
  return value === ALL_BRANDS_VALUE;
}
