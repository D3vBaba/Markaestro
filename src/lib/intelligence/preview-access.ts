import type { RequestContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';

/**
 * The Intelligence private preview allowlist.
 *
 * This is a production access-control decision, so it does not belong in a
 * source constant: adding a preview user should not require a deploy. The
 * order of precedence is configuration first, hardcoded fallback second.
 *
 *   1. `_featureFlags/intelligencePreview` in Firestore: `{ emails[], uids[] }`.
 *      Editable without shipping code, which is the point.
 *   2. `INTELLIGENCE_PREVIEW_EMAILS` / `INTELLIGENCE_PREVIEW_UIDS`, comma
 *      separated. Useful for staging and for local development.
 *   3. The constants below, kept so nothing breaks during the migration and
 *      so a Firestore outage cannot lock the preview user out of their own
 *      preview.
 *
 * TODO(intelligence-ga): when the preview opens up, this whole module goes
 * away and the gate becomes the entitlement check in `requireIntelligenceAccess`
 * alone. The condition for removal is: Intelligence is generally available on
 * at least one paid plan. Leaving this written down makes that a decision
 * rather than an oversight.
 */
export const INTELLIGENCE_PREVIEW_EMAIL = 'd3vbaba@gmail.com';
export const INTELLIGENCE_PREVIEW_UID = 'KTKvHOYFlrRyHw14oGi3jnqIr6m2';

const PREVIEW_FLAG_PATH = '_featureFlags/intelligencePreview';

/**
 * Cached briefly. The allowlist is read on every gated request, and a preview
 * that costs a Firestore read per request is a preview that shows up on the
 * bill. Sixty seconds is short enough that adding a user feels immediate.
 */
const CACHE_TTL_MS = 60_000;

type Allowlist = { emails: Set<string>; uids: Set<string> };

let cached: { value: Allowlist; expiresAt: number } | null = null;

function splitEnvList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function baseAllowlist(): Allowlist {
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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** Test seam: drops the cache so a test can change the configured allowlist. */
export function resetIntelligencePreviewCache(): void {
  cached = null;
}

async function loadAllowlist(): Promise<Allowlist> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const value = baseAllowlist();
  try {
    const snap = await adminDb.doc(PREVIEW_FLAG_PATH).get();
    const data = snap.exists ? snap.data() ?? {} : {};
    for (const email of asStringArray(data.emails)) value.emails.add(email.trim().toLowerCase());
    for (const uid of asStringArray(data.uids)) value.uids.add(uid.trim());
  } catch (error) {
    // Fall back to the constants rather than locking everyone out. A gate that
    // fails closed on its own configuration read turns a Firestore blip into a
    // total outage of the feature.
    logger.warn('intelligence preview allowlist read failed; using the built-in list', {
      event: 'intelligence.preview_allowlist_read_failed',
      err: error,
    });
  }

  cached = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/**
 * Synchronous check against the built-in list only.
 *
 * Used by navigation, which renders before any await would be welcome. It can
 * under-report a configured preview user for up to one navigation, which shows
 * a missing nav item rather than granting access, so the failure direction is
 * the safe one. Every route still gates on the async check.
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

export async function canAccessIntelligencePreviewAsync(input: {
  email?: string | null;
  uid?: string | null;
}): Promise<boolean> {
  const list = await loadAllowlist();
  const email = input.email?.trim().toLowerCase();
  if (email && list.emails.has(email)) return true;
  if (input.uid && list.uids.has(input.uid)) return true;
  return false;
}

export async function requireIntelligencePreviewUser(
  ctx: Pick<RequestContext, 'email' | 'uid'>,
): Promise<void> {
  if (!(await canAccessIntelligencePreviewAsync(ctx))) throw new Error('FEATURE_NOT_AVAILABLE');
}
