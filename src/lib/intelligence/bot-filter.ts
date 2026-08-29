/**
 * Click classification for the public link shortener.
 *
 * `GET /r/[code]` is the only unauthenticated write path in the product. Every
 * hit costs three Firestore writes and moves a counter that feeds the 90-day
 * attribution window, and attribution data that has been quietly poisoned is
 * not recoverable after the fact.
 *
 * The largest source of false clicks is not adversarial: every social platform
 * prefetches links posted to it, so Markaestro's own posting flow generates
 * them. Those hits are classified and excluded rather than dropped, because the
 * redirect itself must always still happen.
 *
 * Privacy stance is unchanged: no raw IP, user agent, or referrer is ever
 * stored. The IP is hashed with a daily-rotating salt purely to dedupe repeat
 * hits, and the hash is discarded once the dedupe key is built.
 */

import { createHash, createHmac } from 'node:crypto';

export type ClickClassification = 'human' | 'bot';

/**
 * Substrings that mark an automated client. Conservative on purpose: a false
 * "bot" only removes a click from analytics, but a false "human" is what
 * inflates a customer's numbers.
 */
const BOT_UA_PATTERNS = [
  'bot',
  'crawl',
  'spider',
  'slurp',
  'preview',
  'curl',
  'wget',
  'python-requests',
  'headless',
  'monitoring',
  'scrapy',
  'http-client',
  'okhttp',
  'go-http-client',
  'java/',
  'libwww-perl',
  // Named link-preview agents. These are the highest-volume false clicks in
  // practice: they fire once per platform per share, before any person looks.
  'slackbot',
  'twitterbot',
  'facebookexternalhit',
  'whatsapp',
  'discordbot',
  'linkedinbot',
  'telegrambot',
  'pinterest',
  'redditbot',
  'embedly',
  'quora link preview',
  'skypeuripreview',
  'applebot',
  'vkshare',
  'tumblr',
  'bitlybot',
  'nuzzel',
  'outbrain',
  'flipboard',
  'google-inspectiontool',
  'chrome-lighthouse',
];

/** An empty user agent is a script far more often than it is a browser. */
export function classifyUserAgent(userAgent: string | null | undefined): ClickClassification {
  const value = (userAgent || '').trim().toLowerCase();
  if (!value) return 'bot';
  return BOT_UA_PATTERNS.some((pattern) => value.includes(pattern)) ? 'bot' : 'human';
}

/**
 * Daily-rotating salt for IP hashing. Derived from the app's existing secret so
 * there is nothing new to provision, and rotated by date so a hash cannot be
 * correlated across days even if the salt later leaks.
 */
function dailySalt(now: Date): string {
  const root =
    process.env.CONVERSION_INGEST_SECRET ||
    process.env.ENCRYPTION_KEY ||
    'markaestro-click-dedupe';
  const day = now.toISOString().slice(0, 10);
  return createHmac('sha256', root).update(`click-dedupe:${day}`).digest('hex');
}

/** Extract the client IP the same way the rate limiter does. */
export function clientIpFromHeaders(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * Stable, non-reversible per-day identifier for "this visitor, this link".
 * Used only as a dedupe key; never stored on the click document.
 */
export function clickDedupeKey(code: string, ip: string, now: Date = new Date()): string {
  return createHash('sha256').update(`${dailySalt(now)}:${code}:${ip}`).digest('hex').slice(0, 32);
}

/**
 * Window in which a repeat hit from the same visitor and code is treated as one
 * click. Covers double-taps and the prefetch-then-navigate pattern, where a
 * browser or app fetches the link and then the person immediately follows it.
 */
export const CLICK_DEDUPE_WINDOW_MS = 30_000;
