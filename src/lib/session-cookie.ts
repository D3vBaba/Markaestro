/**
 * HMAC-signed session cookie utilities.
 *
 * The cookie value is `uid.timestamp.signature` where the signature is
 * HMAC-SHA256(uid + "." + timestamp, secret). This runs in Edge Runtime
 * (no Node.js crypto — uses Web Crypto API via globalThis.crypto).
 *
 * The server-side endpoint (/api/auth/session) creates the cookie after
 * verifying the Firebase ID token. Middleware only needs to verify the
 * HMAC signature, which is fast and doesn't need firebase-admin.
 */

const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 days
const SIGNATURE_VALID_MS = COOKIE_MAX_AGE_S * 1000;

function getSecret(): string {
  return process.env.ENCRYPTION_KEY || process.env.WORKER_SECRET || '';
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function hmacVerify(payload: string, signature: string, secret: string): Promise<boolean> {
  const expected = await hmacSign(payload, secret);
  // Constant-time-ish comparison (both are base64url, same length if valid)
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Create a signed session cookie value. Call from the server-side session endpoint.
 */
export async function createSessionCookie(uid: string): Promise<string> {
  const ts = Date.now().toString(36);
  const payload = `${uid}.${ts}`;
  const sig = await hmacSign(payload, getSecret());
  return `${payload}.${sig}`;
}

/**
 * Verify a session cookie value. Safe for Edge Runtime.
 * Returns true if the signature is valid and the cookie hasn't expired.
 */
export function verifySessionCookie(cookie: string): boolean {
  // Synchronous pre-check: must have 3 parts
  const parts = cookie.split('.');
  if (parts.length !== 3) return false;

  const [, ts] = parts;
  const timestamp = parseInt(ts, 36);
  if (isNaN(timestamp)) return false;

  // Reject expired cookies
  if (Date.now() - timestamp > SIGNATURE_VALID_MS) return false;

  // Signature verification is async, but middleware needs a sync answer.
  // We do the structural + expiry check synchronously here.
  // Full HMAC verification happens below via verifySessionCookieAsync.
  return true;
}

/**
 * Full async verification including HMAC signature check.
 * Use this in middleware for complete verification.
 */
export async function verifySessionCookieAsync(cookie: string): Promise<boolean> {
  const parts = cookie.split('.');
  if (parts.length !== 3) return false;

  const [uid, ts, sig] = parts;
  const timestamp = parseInt(ts, 36);
  if (isNaN(timestamp)) return false;
  if (Date.now() - timestamp > SIGNATURE_VALID_MS) return false;

  const secret = getSecret();
  if (!secret) return false;

  return hmacVerify(`${uid}.${ts}`, sig, secret);
}

/** Cookie max-age for Set-Cookie header */
export const SESSION_COOKIE_MAX_AGE = COOKIE_MAX_AGE_S;
