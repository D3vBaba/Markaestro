/**
 * Click classification for the public link shortener (`RL-01`).
 *
 * The redirect is unauthenticated and every hit costs Firestore writes that
 * move attribution counters, so what counts as a real click is a correctness
 * question, not a cosmetic one. Poisoned attribution is not recoverable after
 * the fact.
 */
import { describe, expect, it } from 'vitest';
import {
  CLICK_DEDUPE_WINDOW_MS,
  classifyUserAgent,
  clickDedupeKey,
  clientIpFromHeaders,
} from '../intelligence/bot-filter';

describe('user agent classification', () => {
  it('treats real browsers as human', () => {
    const browsers = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    ];
    for (const ua of browsers) {
      expect(classifyUserAgent(ua), ua).toBe('human');
    }
  });

  it('catches the link-preview agents our own posting flow generates', () => {
    // Every social platform prefetches links posted to it, so these are the
    // highest-volume false clicks in practice.
    const previewers = [
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'Twitterbot/1.0',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.23.20.0',
      'Discordbot/2.0 (+https://discordapp.com)',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
      'TelegramBot (like TwitterBot)',
      'Pinterest/0.2 (+http://www.pinterest.com/bot.html)',
    ];
    for (const ua of previewers) {
      expect(classifyUserAgent(ua), ua).toBe('bot');
    }
  });

  it('catches generic crawlers and scripting clients', () => {
    const bots = [
      'Googlebot/2.1 (+http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'Mozilla/5.0 (compatible; Yahoo! Slurp)',
      'curl/8.4.0',
      'Wget/1.21.4',
      'python-requests/2.31.0',
      'HeadlessChrome/120.0.0.0',
      'Scrapy/2.11 (+https://scrapy.org)',
      'okhttp/4.12.0',
      'Go-http-client/2.0',
      'Java/17.0.9',
    ];
    for (const ua of bots) {
      expect(classifyUserAgent(ua), ua).toBe('bot');
    }
  });

  it('treats a missing or blank user agent as a bot', () => {
    expect(classifyUserAgent(null)).toBe('bot');
    expect(classifyUserAgent(undefined)).toBe('bot');
    expect(classifyUserAgent('')).toBe('bot');
    expect(classifyUserAgent('   ')).toBe('bot');
  });

  it('is case insensitive', () => {
    expect(classifyUserAgent('SLACKBOT/1.0')).toBe('bot');
    expect(classifyUserAgent('CuRl/8.0')).toBe('bot');
  });
});

describe('client IP extraction', () => {
  it('takes the first hop from x-forwarded-for', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.5, 70.41.3.18, 150.172.238.178' });
    expect(clientIpFromHeaders(headers)).toBe('203.0.113.5');
  });

  it('falls back to x-real-ip, then to a placeholder', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7');
    expect(clientIpFromHeaders(new Headers())).toBe('unknown');
  });
});

describe('click dedupe key', () => {
  const ip = '203.0.113.5';
  const day = new Date('2026-08-29T10:00:00.000Z');

  it('is stable for the same visitor, code, and day', () => {
    expect(clickDedupeKey('abc', ip, day)).toBe(clickDedupeKey('abc', ip, day));
  });

  it('separates different codes and different visitors', () => {
    expect(clickDedupeKey('abc', ip, day)).not.toBe(clickDedupeKey('xyz', ip, day));
    expect(clickDedupeKey('abc', ip, day)).not.toBe(clickDedupeKey('abc', '198.51.100.7', day));
  });

  it('rotates daily, so a hash cannot be correlated across days', () => {
    const nextDay = new Date('2026-08-30T10:00:00.000Z');
    expect(clickDedupeKey('abc', ip, day)).not.toBe(clickDedupeKey('abc', ip, nextDay));
  });

  it('does not leak the raw IP', () => {
    const key = clickDedupeKey('abc', ip, day);
    expect(key).not.toContain(ip);
    expect(key).toMatch(/^[a-f0-9]{32}$/);
  });

  it('dedupes over a window long enough to cover prefetch-then-navigate', () => {
    expect(CLICK_DEDUPE_WINDOW_MS).toBe(30_000);
  });
});
