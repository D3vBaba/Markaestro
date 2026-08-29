/**
 * The Intelligence private preview allowlist: the CLIENT-SAFE half.
 *
 * This module is imported by navigation and a client hook, so it must never
 * touch firebase-admin: the one time it did, the whole Admin SDK landed in
 * the browser bundle and the production build failed on Node built-ins
 * (`net`, `tls`, `child_process`). The Firestore-configured half lives in
 * `preview-access-server.ts`, which routes import instead.
 *
 * The order of precedence for the full gate is configuration first,
 * hardcoded fallback second; this half only knows the env-var and constant
 * layers, which is deliberate: the client uses it to decide whether to SHOW
 * an entry point, and under-reporting a configured preview user for one
 * navigation shows a missing nav item, never grants access. Every route
 * still gates on the async server check.
 *
 * TODO(intelligence-ga): when the preview opens up, both halves go away and
 * the gate becomes the entitlement check in `requireIntelligenceAccess`
 * alone. The condition for removal is: Intelligence is generally available
 * on at least one paid plan.
 */
export const INTELLIGENCE_PREVIEW_EMAIL = 'd3vbaba@gmail.com';
export const INTELLIGENCE_PREVIEW_UID = 'KTKvHOYFlrRyHw14oGi3jnqIr6m2';

function splitEnvList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** The env-var and constant layers of the allowlist. */
export function baseAllowlist(): { emails: Set<string>; uids: Set<string> } {
  return {
    emails: new Set([
      INTELLIGENCE_PREVIEW_EMAIL,
      ...splitEnvList(process.env.INTELLIGENCE_PREVIEW_EMAILS).map((e) => e.toLowerCase()),
    ]),
    uids: new Set([
      INTELLIGENCE_PREVIEW_UID,
      ...splitEnvList(process.env.INTELLIGENCE_PREVIEW_UIDS),
    ]),
  };
}

/**
 * Synchronous check against the built-in list only. Used by navigation and
 * the client hook, which render before any await would be welcome.
 */
export function canAccessIntelligencePreview(input: {
  email?: string | null;
  uid?: string | null;
}): boolean {
  const list = baseAllowlist();
  const email = input.email?.trim().toLowerCase();
  if (email && list.emails.has(email)) return true;
  if (input.uid && list.uids.has(input.uid)) return true;
  return false;
}
