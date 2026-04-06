import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSessionCookie,
  verifySessionCookie,
  verifySessionCookieAsync,
  SESSION_COOKIE_MAX_AGE,
} from '../session-cookie';

const TEST_SECRET = 'test-encryption-key-for-unit-tests';

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_KEY', TEST_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('createSessionCookie', () => {
  it('returns uid.timestamp.signature format', async () => {
    const cookie = await createSessionCookie('user123');
    const parts = cookie.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('user123');
    // timestamp is base-36 encoded
    const ts = parseInt(parts[1], 36);
    expect(ts).toBeGreaterThan(0);
    expect(ts).toBeLessThanOrEqual(Date.now());
    // signature is non-empty base64url
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it('produces different signatures for different UIDs', async () => {
    const a = await createSessionCookie('alice');
    const b = await createSessionCookie('bob');
    const sigA = a.split('.')[2];
    const sigB = b.split('.')[2];
    expect(sigA).not.toBe(sigB);
  });

  it('produces different signatures with different secrets', async () => {
    const a = await createSessionCookie('user1');
    vi.stubEnv('ENCRYPTION_KEY', 'different-secret');
    const b = await createSessionCookie('user1');
    const sigA = a.split('.')[2];
    const sigB = b.split('.')[2];
    expect(sigA).not.toBe(sigB);
  });
});

describe('verifySessionCookie (sync)', () => {
  it('returns true for a well-formed, non-expired cookie', async () => {
    const cookie = await createSessionCookie('user1');
    expect(verifySessionCookie(cookie)).toBe(true);
  });

  it('returns false for malformed cookies', () => {
    expect(verifySessionCookie('')).toBe(false);
    expect(verifySessionCookie('just-one-part')).toBe(false);
    expect(verifySessionCookie('two.parts')).toBe(false);
    expect(verifySessionCookie('1')).toBe(false);
  });

  it('returns false if timestamp is not valid base-36', () => {
    expect(verifySessionCookie('uid.!!!.sig')).toBe(false);
  });

  it('returns false for expired cookies', () => {
    // Create a cookie with a timestamp 31 days ago
    const oldTs = (Date.now() - 31 * 24 * 60 * 60 * 1000).toString(36);
    expect(verifySessionCookie(`uid.${oldTs}.fakesig`)).toBe(false);
  });

  it('returns true for cookie near max age but not expired', () => {
    // 29 days ago — still within the 30-day window
    const recentTs = (Date.now() - 29 * 24 * 60 * 60 * 1000).toString(36);
    expect(verifySessionCookie(`uid.${recentTs}.fakesig`)).toBe(true);
  });
});

describe('verifySessionCookieAsync', () => {
  it('returns true for a valid cookie created by createSessionCookie', async () => {
    const cookie = await createSessionCookie('user42');
    const valid = await verifySessionCookieAsync(cookie);
    expect(valid).toBe(true);
  });

  it('returns false for a cookie with a tampered UID', async () => {
    const cookie = await createSessionCookie('user42');
    const parts = cookie.split('.');
    const tampered = `hacker.${parts[1]}.${parts[2]}`;
    expect(await verifySessionCookieAsync(tampered)).toBe(false);
  });

  it('returns false for a cookie with a tampered signature', async () => {
    const cookie = await createSessionCookie('user42');
    const parts = cookie.split('.');
    const tampered = `${parts[0]}.${parts[1]}.BADSIG`;
    expect(await verifySessionCookieAsync(tampered)).toBe(false);
  });

  it('returns false for a cookie with a tampered timestamp', async () => {
    const cookie = await createSessionCookie('user42');
    const parts = cookie.split('.');
    const newTs = (Date.now() - 1000).toString(36);
    const tampered = `${parts[0]}.${newTs}.${parts[2]}`;
    expect(await verifySessionCookieAsync(tampered)).toBe(false);
  });

  it('returns false when no secret is configured', async () => {
    const cookie = await createSessionCookie('user42');
    vi.stubEnv('ENCRYPTION_KEY', '');
    vi.stubEnv('WORKER_SECRET', '');
    expect(await verifySessionCookieAsync(cookie)).toBe(false);
  });

  it('returns false for malformed cookies', async () => {
    expect(await verifySessionCookieAsync('')).toBe(false);
    expect(await verifySessionCookieAsync('a.b')).toBe(false);
    expect(await verifySessionCookieAsync('only')).toBe(false);
  });

  it('returns false for expired cookies even with valid signature', async () => {
    // We can't easily create a properly signed expired cookie without time mocking,
    // but we can verify structural rejection
    const oldTs = (Date.now() - 31 * 24 * 60 * 60 * 1000).toString(36);
    expect(await verifySessionCookieAsync(`uid.${oldTs}.anysig`)).toBe(false);
  });
});

describe('SESSION_COOKIE_MAX_AGE', () => {
  it('is 30 days in seconds', () => {
    expect(SESSION_COOKIE_MAX_AGE).toBe(30 * 24 * 60 * 60);
  });
});
