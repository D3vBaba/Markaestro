/**
 * Resolve a caller-supplied `next` / `returnTo` parameter into a safe internal
 * redirect target, or fall back.
 *
 * These parameters are a gift for attackers: they are read on pages the user
 * reaches mid-flow (OAuth return, Stripe checkout return) where they are primed
 * to trust wherever they land, and the value is under whoever crafted the URL's
 * control. A permissive `startsWith('/')` check is not enough — we need to
 * reject:
 *
 *   - Protocol-relative URLs: `//evil.com`
 *   - Backslash-prefix tricks some browsers normalize: `/\evil.com`, `/\\evil.com`
 *   - URLs with an embedded scheme: `https://evil.com`, `javascript:alert(1)`
 *   - Paths containing control characters or whitespace used to smuggle hosts
 *   - Self-loops back to the resolving page that would spin forever
 *
 * The final check uses `new URL(candidate, base)` against a placeholder origin
 * and requires the resulting origin to match. If it doesn't, the parameter is
 * navigating off-site and must be dropped.
 */

const PLACEHOLDER_ORIGIN = 'https://markaestro.local';

/**
 * The validated path, or null when the input is missing or unsafe — for
 * callers that need to distinguish "no destination given" from "this one",
 * because their default differs by situation.
 */
export function safeInternalPathOrNull(
  nextParam: string | null | undefined,
  opts: { selfPrefix?: string } = {},
): string | null {
  const { selfPrefix } = opts;
  if (!nextParam) return null;

  // Hard-reject obviously off-site patterns before we hand the string to the
  // URL parser — `new URL('//evil.com', base)` parses as cross-origin.
  if (nextParam.length > 2048) return null;
  if (!nextParam.startsWith('/')) return null;
  if (nextParam.startsWith('//')) return null;
  if (nextParam.startsWith('/\\')) return null;
  if (/[\x00-\x1f\s]/.test(nextParam)) return null;

  let parsed: URL;
  try {
    parsed = new URL(nextParam, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }

  if (parsed.origin !== PLACEHOLDER_ORIGIN) return null;
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (selfPrefix && parsed.pathname.startsWith(selfPrefix)) return null;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** The validated path, or `fallback` when the input is missing or unsafe. */
export function getSafeInternalPath(
  nextParam: string | null | undefined,
  opts: { fallback: string; selfPrefix?: string },
): string {
  return safeInternalPathOrNull(nextParam, opts) ?? opts.fallback;
}
