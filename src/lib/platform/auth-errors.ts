import type { SocialChannel } from '@/lib/schemas';

/**
 * Whether a publish failure means the platform rejected our credentials rather
 * than the content.
 *
 * These have to be recorded on the connection. A dead token keeps returning the
 * same error on every retry, and if nothing marks the connection the channel
 * goes on claiming it is linked while every scheduled post quietly fails —
 * which is exactly how a brand's Threads posts failed for days with a green
 * "Linked" badge on screen.
 *
 * Matching is deliberately conservative: only messages that clearly describe an
 * expired, invalid, revoked, or insufficient authorization. Content problems,
 * rate limits, and outages must not disable a healthy connection.
 */
const AUTH_FAILURE_PATTERNS: RegExp[] = [
  /error validating access token/i,
  /session has expired/i,
  /access token .{0,40}(expired|invalid|revoked)/i,
  /(expired|invalid|revoked) .{0,20}access token/i,
  /oauth ?exception/i,
  /invalid[_ ]grant/i,
  /\bunauthorized\b|\bunauthorised\b/i,
  // Meta: a Page token whose parent grant no longer covers the Page.
  /impersonating a user's page/i,
  // Threads: the account itself must complete a step on threads.com.
  /cannot access the app till you log in/i,
  // Instagram Login blanket refusal (account not eligible for the API).
  /couldn't authorize this account/i,
  /LINKEDIN_AUTH_REVOKED|LINKEDIN_PERMISSION_DENIED/i,
];

export function isPublishAuthFailure(error?: string | null): boolean {
  if (!error) return false;
  return AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(error));
}

/**
 * What to store on the connection. The platform's own message is usually the
 * most actionable thing we have — Threads, for instance, names the exact step
 * the creator has to take — so it is kept unless we can say something better.
 */
export function publishAuthFailureMessage(channel: SocialChannel, error: string): string {
  if (channel === 'facebook') {
    return 'Facebook no longer grants this Page to Markaestro. Reconnect Facebook and tick this Page in the permissions dialog.';
  }
  return error;
}
