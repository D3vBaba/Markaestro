import { getSafeInternalPath } from "@/lib/safe-internal-path";

/**
 * Resolve the `next` query parameter on /oauth/complete into a safe internal
 * redirect target, or fall back to `/settings`. The validation itself — and
 * the reasoning behind each rejected pattern — lives in getSafeInternalPath,
 * which the Stripe checkout return shares.
 */
export function getSafeNextPath(nextParam: string | null | undefined): string {
  return getSafeInternalPath(nextParam, {
    fallback: "/settings",
    selfPrefix: "/oauth/complete",
  });
}
