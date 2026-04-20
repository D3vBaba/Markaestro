/**
 * Resolve the `next` query parameter on /oauth/complete into a safe
 * internal redirect target, or fall back to `/settings`.
 *
 * The OAuth-complete page is a gift for attackers: it's always accessed
 * mid-auth-flow, the user is primed to trust the redirect, and the
 * parameter is under the attacker's control (they crafted the OAuth URL).
 * A permissive `startsWith('/')` check is not enough — we need to reject:
 *
 *   - Protocol-relative URLs: `//evil.com`
 *   - Backslash-prefix tricks some browsers normalize: `/\evil.com`, `/\\evil.com`
 *   - URLs with an embedded scheme: `https://evil.com`, `javascript:alert(1)`
 *   - Paths containing control characters or whitespace used to smuggle hosts
 *   - Self-loops back to `/oauth/complete` that would spin forever
 *
 * The final check uses `new URL(candidate, base)` against a placeholder
 * origin and requires the resulting origin to match. If it doesn't, the
 * parameter is navigating off-site and must be dropped.
 */
const FALLBACK = "/settings";
const SELF_PREFIX = "/oauth/complete";
const PLACEHOLDER_ORIGIN = "https://markaestro.local";

export function getSafeNextPath(nextParam: string | null | undefined): string {
  if (!nextParam) return FALLBACK;

  // Hard-reject obviously off-site patterns before we hand the string to the
  // URL parser — `new URL('//evil.com', base)` parses as cross-origin.
  if (nextParam.length > 2048) return FALLBACK;
  if (!nextParam.startsWith("/")) return FALLBACK;
  if (nextParam.startsWith("//")) return FALLBACK;
  if (nextParam.startsWith("/\\")) return FALLBACK;
  if (/[\x00-\x1f\s]/.test(nextParam)) return FALLBACK;

  let parsed: URL;
  try {
    parsed = new URL(nextParam, PLACEHOLDER_ORIGIN);
  } catch {
    return FALLBACK;
  }

  if (parsed.origin !== PLACEHOLDER_ORIGIN) return FALLBACK;
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return FALLBACK;

  if (parsed.pathname.startsWith(SELF_PREFIX)) return FALLBACK;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
