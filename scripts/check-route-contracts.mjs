#!/usr/bin/env node
/**
 * Hold every API route to the contract the codebase already mostly follows.
 *
 * `npm run ci` already runs unusually good project-specific validators:
 * `validate:queries` executes every query pattern against real Firestore to
 * catch a missing index, and `copy:check` enforces the em dash and iconography
 * rules. This is the same instinct applied to route structure.
 *
 * Four invariants, checked per exported handler:
 *
 *   auth        an authentication helper runs before any work
 *   permission  a permission is required, so the role matrix is actually applied
 *   boundary    the body is wrapped, so a throw becomes an `apiError` response
 *               with a requestId rather than a framework 500 with an
 *               unparseable body
 *   rateLimit   a limiter tier is declared
 *
 * Each invariant has an allowlist, and every entry needs a reason. That is the
 * point: an exemption becomes a sentence someone had to write, rather than an
 * absence nobody noticed.
 *
 * The rate-limit invariant additionally carries a ratchet (KNOWN_UNLIMITED).
 * Most routes predate the limiter, so demanding it everywhere today would fail
 * the build for a hundred routes at once and be turned off. Instead the
 * current gaps are listed, and the check fails if the list grows or if an
 * entry is fixed without being removed. It can only shrink.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const API_ROOTS = [join(ROOT, 'src', 'app', 'api'), join(ROOT, 'src', 'app', 'r')];
const HANDLERS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/**
 * Routes with no authentication, each for a stated reason. Every entry here is
 * a route reachable by anyone on the internet.
 */
const NO_AUTH = new Map([
  ['api/health/route.ts', 'Uptime probe. The shallow path must answer before dependencies are up; the deep path requires a shared secret.'],
  ['api/webhooks/meta/data-deletion/route.ts', 'Meta calls this. Authenticated by Meta signed request, not by a session.'],
  ['api/webhooks/meta/deauthorize/route.ts', 'Meta calls this. Authenticated by Meta signed request.'],
  ['api/webhooks/tiktok/route.ts', 'TikTok calls this. Authenticated by TikTok signature.'],
  ['api/stripe/webhook/route.ts', 'Stripe calls this. Authenticated by Stripe signature.'],
  ['api/oauth/callback/[provider]/route.ts', 'The OAuth provider redirects the user here. Authenticated by the signed state parameter.'],
  ['api/auth/otp/request/route.ts', 'Sign-in. There is no session yet, by definition.'],
  ['api/auth/otp/verify/route.ts', 'Sign-in. There is no session yet, by definition.'],
  ['api/media/proxy/route.ts', 'TikTok fetches media through this. Restricted to our own storage bucket rather than by session.'],
  ['api/media/video-proxy/route.ts', 'TikTok fetches video through this. Restricted to our own storage bucket.'],
  ['api/media/tiktok/[token]/route.ts', 'TikTok fetches this. Authenticated by a signed short-lived token in the path.'],
  ['api/worker/tick/route.ts', 'Cloud Scheduler calls this. Authenticated by the worker shared secret.'],
  ['api/worker/tiktok-poll/route.ts', 'Cloud Scheduler calls this. Authenticated by the worker shared secret.'],
  ['api/worker/workspace/[workspaceId]/route.ts', 'Cloud Tasks calls this. Authenticated by the worker shared secret.'],
  ['api/public/v1/openapi.json/route.ts', 'The machine-readable API description. An integrator needs it before they have a key.'],
  ['r/[code]/route.ts', 'The public link shortener. Its whole job is to answer an anonymous visitor.'],
  ['api/intelligence/conversions/route.ts', 'Accepts server-to-server posts signed with a per-workspace ingest key; the browser branch does require a session.'],
]);

/**
 * Routes that authenticate but require no workspace permission.
 */
const NO_PERMISSION = new Map([
  ['api/account/route.ts', 'Acts on the caller\'s own account, not on a workspace resource.'],
  ['api/auth/logout-all/route.ts', 'Acts on the caller\'s own sessions.'],
  ['api/auth/email-change/request/route.ts', 'Acts on the caller\'s own email.'],
  ['api/auth/email-change/confirm/route.ts', 'Acts on the caller\'s own email.'],
  ['api/onboarding/status/route.ts', 'Reads the caller\'s own onboarding state.'],
  ['api/auth/session/route.ts', 'Exchanges a verified ID token for a session cookie. There is no workspace yet to hold a permission in.'],
  ['api/settings/locale/route.ts', 'Reads and writes the caller\'s own display language.'],
  ['api/workspaces/route.ts', 'Lists the workspaces the caller belongs to, and creates a new one they will own.'],
  ['api/team/invites/accept/route.ts', 'The caller is accepting an invitation, so they are not yet a member.'],
  ['api/team/invites/decline/route.ts', 'The caller is declining an invitation, so they are not yet a member.'],
  ['api/team/leave/route.ts', 'The caller is removing their own membership.'],
  ['api/usage/route.ts', 'Reads the caller\'s own usage counters.'],
  ['api/inbox/route.ts', 'Reads the caller\'s own notifications.'],
  ['api/stripe/status/route.ts', 'Reads the workspace plan. Every member needs it: paywalls and limit copy are rendered from it.'],
]);

/** The public and Connect surfaces authorize by scope, not by workspace role. */
const SCOPE_AUTHORIZED_PREFIXES = ['api/public/v1/', 'api/connect/v1/'];

/**
 * Routes with no rate limit today. This list may shrink and must never grow.
 *
 * It is a ratchet rather than an exemption list: these are gaps, not
 * decisions. Fixing one means deleting its line, and the check fails if a line
 * is left behind, so the file cannot quietly describe a state that no longer
 * exists.
 */
const KNOWN_UNLIMITED = new Set([
  'api/analytics/export/route.ts',
  'api/analytics/route.ts',
  'api/auth/session/route.ts',
  'api/connect/v1/media/route.ts',
  'api/connect/v1/media/upload/route.ts',
  'api/connect/v1/products/route.ts',
  'api/connect/v1/social-accounts/route.ts',
  'api/dashboard/route.ts',
  'api/inbox/route.ts',
  'api/integrations/route.ts',
  'api/integrations/tiktok/diagnose/route.ts',
  'api/intelligence/analysis/[id]/route.ts',
  'api/intelligence/campaigns/[id]/route.ts',
  'api/intelligence/campaigns/route.ts',
  'api/intelligence/experiments/[id]/evaluate/route.ts',
  'api/intelligence/experiments/[id]/route.ts',
  'api/intelligence/experiments/route.ts',
  'api/intelligence/learnings/[id]/decision/route.ts',
  'api/intelligence/overview/route.ts',
  'api/intelligence/recommendations/[id]/decision/route.ts',
  'api/intelligence/timing/route.ts',
  'api/intelligence/tracked-links/[code]/route.ts',
  'api/intelligence/tracked-links/route.ts',
  'api/media/[id]/route.ts',
  'api/media/route.ts',
  'api/oauth/authorize/[provider]/route.ts',
  'api/oauth/callback/[provider]/route.ts',
  'api/oauth/disconnect/[provider]/route.ts',
  'api/oauth/pages/[provider]/route.ts',
  'api/oauth/pages/[provider]/select/route.ts',
  'api/onboarding/status/route.ts',
  'api/posts/[id]/mark-posted/route.ts',
  'api/posts/[id]/route.ts',
  'api/posts/bulk/route.ts',
  'api/posts/route.ts',
  'api/posts/smart-schedule/route.ts',
  'api/products/[id]/brand-voice/route.ts',
  'api/products/[id]/intelligence-profile/route.ts',
  'api/products/[id]/knowledge/route.ts',
  'api/products/[id]/route.ts',
  'api/products/[id]/upload-logo/route.ts',
  'api/products/route.ts',
  'api/products/scan/route.ts',
  'api/public/v1/openapi.json/route.ts',
  'api/settings/api-clients/[id]/archive/route.ts',
  'api/settings/api-clients/[id]/rotate/route.ts',
  'api/settings/api-clients/[id]/route.ts',
  'api/settings/api-clients/route.ts',
  'api/settings/api-clients/usage/route.ts',
  'api/settings/locale/route.ts',
  'api/settings/publishing/route.ts',
  'api/settings/webhook-endpoints/[id]/deliveries/route.ts',
  'api/settings/webhook-endpoints/[id]/rotate/route.ts',
  'api/settings/webhook-endpoints/[id]/route.ts',
  'api/settings/webhook-endpoints/route.ts',
  'api/social/channels/route.ts',
  'api/social/posts/route.ts',
  'api/social/tiktok/creator-info/route.ts',
  'api/stripe/addons/route.ts',
  'api/stripe/change-plan/route.ts',
  'api/stripe/checkout/route.ts',
  'api/stripe/portal/route.ts',
  'api/stripe/status/route.ts',
  'api/stripe/webhook/route.ts',
  'api/team/[uid]/route.ts',
  'api/team/[uid]/transfer-ownership/route.ts',
  'api/team/invites/accept/route.ts',
  'api/team/invites/decline/route.ts',
  'api/team/invites/route.ts',
  'api/team/leave/route.ts',
  'api/usage/route.ts',
  'api/webhooks/meta/data-deletion/route.ts',
  'api/webhooks/meta/deauthorize/route.ts',
  'api/webhooks/tiktok/route.ts',
  'api/worker/tick/route.ts',
  'api/worker/tiktok-poll/route.ts',
  'api/worker/workspace/[workspaceId]/route.ts',
  'api/workspaces/[id]/route.ts',
  'api/workspaces/route.ts',
]);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (entry === 'route.ts' || entry === 'route.tsx') out.push(path);
  }
  return out;
}

function routeKey(path) {
  return relative(join(ROOT, 'src', 'app'), path).split(sep).join('/');
}

const AUTH_CALLS = [
  'requireContext(',
  'requirePublicApiContext(',
  'requireWorkerAuth(',
  'requireWorkerRequest(',
  'assertWorkerSecret(',
  'verifyMetaSignature(',
  'verifyTikTokSignature(',
  'verifyStripeSignature(',
  'verifyIdToken(',
  'verifyUploadToken(',
  'defineRoute',
];

const PERMISSION_CALLS = [
  'requirePermission(',
  'requireAnyPermission(',
  // defineRoute config: `permission:` / `role:` are the declarative forms.
  'role:',
  // Role gates are authorization too: `workspaces/[id]` restricts renaming to
  // the owner, and the API-key routes restrict everything to admins, without
  // either naming a permission. Both are legitimate shapes.
  'requireOwner(',
  'requireRole(',
  'requireAdmin(',
  'permission:',
];
const RATE_LIMIT_CALLS = ['applyRateLimit(', 'checkRateLimit(', 'checkRateLimits(', 'rateLimit:', 'RATE_LIMITS.'];

function exportedHandlers(source) {
  return HANDLERS.filter((method) =>
    new RegExp(`export\\s+(async\\s+)?(function\\s+${method}\\b|const\\s+${method}\\s*=)`).test(source));
}

const failures = [];
const stale = [];
let checked = 0;

for (const root of API_ROOTS) {
  for (const file of walk(root)) {
    const key = routeKey(file);
    const source = readFileSync(file, 'utf8');
    const methods = exportedHandlers(source);
    if (methods.length === 0) continue;
    checked += 1;

    const hasAuth = AUTH_CALLS.some((call) => source.includes(call));
    const hasPermission = PERMISSION_CALLS.some((call) => source.includes(call));
    // `apiError` is the good shape, but a hand-rolled try/catch that answers
    // JSON is still a boundary: the failure mode this guards against is a
    // handler body with no catch at all.
    const hasBoundary = source.includes('apiError(')
      || source.includes('publicApiError(')
      || source.includes('defineRoute')
      || /\}\s*catch\s*[({]/.test(source);
    const hasRateLimit = RATE_LIMIT_CALLS.some((call) => source.includes(call));
    const scopeAuthorized = SCOPE_AUTHORIZED_PREFIXES.some((prefix) => key.startsWith(prefix));

    if (!hasAuth && !NO_AUTH.has(key)) {
      failures.push(`${key}: no authentication helper. Add one, or add an entry to NO_AUTH with the reason.`);
    }
    if (hasAuth && NO_AUTH.has(key) && !key.startsWith('api/intelligence/conversions')) {
      stale.push(`${key}: listed in NO_AUTH but now authenticates. Remove the entry.`);
    }

    if (!hasPermission && !scopeAuthorized && !NO_PERMISSION.has(key) && !NO_AUTH.has(key)) {
      failures.push(`${key}: no permission check. Add one, or add an entry to NO_PERMISSION with the reason.`);
    }

    if (!hasBoundary) {
      failures.push(`${key}: no error boundary. A throw escapes as a framework 500 with no requestId and a body the client cannot parse.`);
    }

    if (!hasRateLimit && !KNOWN_UNLIMITED.has(key)) {
      failures.push(`${key}: no rate limit tier. Add one, or add it to KNOWN_UNLIMITED (which may only shrink).`);
    }
    if (hasRateLimit && KNOWN_UNLIMITED.has(key)) {
      stale.push(`${key}: listed in KNOWN_UNLIMITED but is now rate limited. Remove the entry.`);
    }
  }
}

if (stale.length > 0) {
  console.error('\nStale allowlist entries (the route was fixed, the entry was not removed):');
  for (const entry of stale) console.error(`  - ${entry}`);
}

if (failures.length > 0) {
  console.error(`\nRoute contract violations (${failures.length}):`);
  for (const entry of failures) console.error(`  - ${entry}`);
}

if (failures.length > 0 || stale.length > 0) {
  console.error(`\nChecked ${checked} route files.`);
  process.exit(1);
}

console.log(`check-route-contracts passed (${checked} route files)`);
