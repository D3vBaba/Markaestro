/**
 * Helpers for surfacing Instagram Login (graph.instagram.com) failures in a way
 * companies can act on.
 */

/**
 * Shown when graph.instagram.com refuses a freshly-issued Instagram Login token
 * (IGApiException code 100 "Unsupported request") — i.e. the account/app isn't
 * eligible for the Instagram Graph API (typically a personal, non-Professional
 * account, or the app's Instagram product isn't enabled). The durable path for
 * those users is the Facebook Page's linked Instagram, so point them there.
 */
export const IG_LOGIN_UNSUPPORTED_MESSAGE =
  "This Instagram account can't be linked directly. Connect your Facebook Page instead — it includes Instagram (the account must be a Professional/Business account).";

export function isInstagramMethodTypeUnsupported(
  data: { error?: { message?: string } },
  method?: string,
): boolean {
  const message = data?.error?.message || '';
  if (!/unsupported request\s*-\s*method type:/i.test(message)) {
    return false;
  }
  return method ? new RegExp(`method type:\\s*${method}`, 'i').test(message) : true;
}

/**
 * Detect the "Instagram Graph API won't serve this token" condition. The token
 * authenticates (so it is NOT OAuthException 190 "cannot parse"); the Instagram
 * layer instead rejects the request with IGApiException code 100 /
 * "Unsupported request". A bad/expired token gives code 190 and must keep its
 * own error.
 */
export function isInstagramGraphUnsupported(data: {
  error?: { code?: number; message?: string };
}): boolean {
  const err = data?.error;
  if (!err) return false;
  if (isInstagramMethodTypeUnsupported(data)) return false;
  return err.code === 100 || /unsupported request/i.test(err.message || '');
}

/**
 * Detect the blanket "graph.instagram.com refuses this token entirely" state.
 *
 * When an account is ineligible for the Instagram API (personal account, or
 * the token/app pairing isn't served), EVERY endpoint — /me, ig_exchange_token,
 * /media, refresh_access_token — returns IGApiException code 100 "Unsupported
 * request - method type: <verb>". A single method-type error on one verb can
 * be a routing quirk (callers retry GET→POST), but once the retry has happened
 * a method-type error is the refusal itself, not a verb problem.
 *
 * Use this AFTER any GET→POST retry: it treats both the classic code-100
 * "unsupported request" and the method-type variant as the same hard refusal.
 */
export function isInstagramGraphRefusal(data: {
  error?: { code?: number; message?: string };
}): boolean {
  return isInstagramGraphUnsupported(data) || isInstagramMethodTypeUnsupported(data);
}
