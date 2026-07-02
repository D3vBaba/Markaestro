/**
 * Helpers for surfacing Instagram Login (graph.instagram.com) failures in a way
 * companies can act on.
 */

/**
 * Shown when graph.instagram.com refuses a freshly-issued Instagram Login token
 * (IGApiException code 100 "Unsupported request"). Two causes produce the same
 * blanket refusal and can't be told apart server-side:
 *  - the Instagram account isn't a Professional (Business/Creator) account, or
 *  - OUR app's "Instagram API with Instagram business login" setup is
 *    incomplete (app in Development Mode without the account added as an
 *    Instagram Tester, or missing Advanced Access for instagram_business_*).
 * Keep the copy end-user actionable and point at the Facebook Page path,
 * which publishes via the Meta login instead.
 */
export const IG_LOGIN_UNSUPPORTED_MESSAGE =
  "Instagram couldn't authorize this account for publishing. Make sure it's a Professional (Business/Creator) account, or connect your Facebook Page instead — it includes Instagram.";

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
