/**
 * Who can reach the TikTok Direct Post composer.
 *
 * Direct Post is still waiting on TikTok's Content Posting API audit. Until
 * that passes, TikTok forces every post from an unaudited client to SELF_ONLY
 * regardless of what we send — so offering the mode to everyone would hand
 * creators a "post to Everyone" option that silently lands as private. The
 * composer is limited to the accounts doing the pre-audit testing instead.
 *
 * Only the composer UI is gated. The publish path and the documented
 * `settings.postMode` public API field stay open, so the flow remains testable
 * through the API ahead of the audit.
 *
 * Once TikTok approves the client, delete this module and render the mode
 * picker unconditionally.
 */

/** Accounts allowed to use Direct Post in any environment, production included. */
const DIRECT_POST_TESTERS = new Set([
  'd3vbaba@gmail.com',
]);

/**
 * Local and preview builds opt in wholesale with
 * `NEXT_PUBLIC_TIKTOK_DIRECT_POST=1`; production leaves it unset and relies on
 * the allowlist above.
 */
const DIRECT_POST_ENABLED_FOR_ALL = process.env.NEXT_PUBLIC_TIKTOK_DIRECT_POST === '1';

export function canUseTikTokDirectPost(email: string | null | undefined): boolean {
  if (DIRECT_POST_ENABLED_FOR_ALL) return true;
  if (!email) return false;
  return DIRECT_POST_TESTERS.has(email.trim().toLowerCase());
}
