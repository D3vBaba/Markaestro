import type { RequestContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { baseAllowlist } from './preview-access';

/**
 * The Intelligence preview allowlist: the SERVER half (5.15).
 *
 * Adds the Firestore-configured layer on top of the client-safe constants in
 * `preview-access.ts`, so adding a preview user is a document edit rather
 * than a deploy:
 *
 *   1. `_featureFlags/intelligencePreview`: `{ emails[], uids[] }`.
 *   2. `INTELLIGENCE_PREVIEW_EMAILS` / `INTELLIGENCE_PREVIEW_UIDS` env vars.
 *   3. The hardcoded constants, kept so a Firestore outage cannot lock the
 *      preview user out of their own preview.
 *
 * Kept out of `preview-access.ts` because that module is imported by client
 * code, and importing firebase-admin from the client graph puts the Admin
 * SDK in the browser bundle and fails the production build.
 */

const PREVIEW_FLAG_PATH = '_featureFlags/intelligencePreview';

/**
 * Cached briefly. The allowlist is read on every gated request, and a preview
 * that costs a Firestore read per request is a preview that shows up on the
 * bill. Sixty seconds is short enough that adding a user feels immediate.
 */
const CACHE_TTL_MS = 60_000;

type Allowlist = { emails: Set<string>; uids: Set<string> };

let cached: { value: Allowlist; expiresAt: number } | null = null;

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
