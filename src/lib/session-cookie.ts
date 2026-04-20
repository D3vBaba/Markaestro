/**
 * HMAC-signed session cookie utilities.
 *
 * Format: `uid.issuedAtMs(base36).signature(base64url)`
 * The signature is HMAC-SHA256(uid + "." + issuedAtMs, signingKey).
 *
 * Edge-runtime safe (uses Web Crypto, no firebase-admin required).
 *
 * Revocation: the `issuedAtMs` component is compared against the Firebase
 * user's `tokensValidAfterTime` in server-auth.ts. When a password reset,
 * logout-all, or account compromise occurs, we call
 * `adminAuth.revokeRefreshTokens(uid)` which advances tokensValidAfterTime
 * — any cookie minted before that timestamp is then rejected on the next
 * API request. The proxy only does structural + HMAC + expiry checks, so a
 * revoked session may briefly access public, non-API pages, but every
 * authenticated data access goes through server-auth and is blocked.
 */

const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 days
const SIGNATURE_VALID_MS = COOKIE_MAX_AGE_S * 1000;

/**
 * Dedicated session signing key. Falls back to ENCRYPTION_KEY for
 * backward compatibility with deployments that predate the key split.
 */
function getSecret(): string {
  return (
    process.env.SESSION_SIGNING_KEY ||
    process.env.ENCRYPTION_KEY ||
    process.env.WORKER_SECRET ||
    ''
  );
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
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export type SessionCookiePayload = {
  uid: string;
  issuedAtMs: number;
};

export async function createSessionCookie(uid: string): Promise<string> {
  const issuedAtMs = Date.now();
  const ts = issuedAtMs.toString(36);
  const payload = `${uid}.${ts}`;
  const sig = await hmacSign(payload, getSecret());
  return `${payload}.${sig}`;
}

/**
 * Structural + expiry check only (no HMAC). Use `verifySessionCookieAsync`
 * to cryptographically verify.
 */
export function verifySessionCookie(cookie: string): boolean {
  const parts = cookie.split('.');
  if (parts.length !== 3) return false;

  const [, ts] = parts;
  const timestamp = parseInt(ts, 36);
  if (!Number.isFinite(timestamp)) return false;
  if (Date.now() - timestamp > SIGNATURE_VALID_MS) return false;

  return true;
}

/**
 * Full async verification including HMAC signature check. Returns the
 * decoded payload on success or `null` on failure.
 */
export async function decodeSessionCookie(cookie: string): Promise<SessionCookiePayload | null> {
  const parts = cookie.split('.');
  if (parts.length !== 3) return null;

  const [uid, ts, sig] = parts;
  const issuedAtMs = parseInt(ts, 36);
  if (!uid || !Number.isFinite(issuedAtMs)) return null;
  if (Date.now() - issuedAtMs > SIGNATURE_VALID_MS) return null;

  const secret = getSecret();
  if (!secret) return null;

  const ok = await hmacVerify(`${uid}.${ts}`, sig, secret);
  return ok ? { uid, issuedAtMs } : null;
}

/** Back-compat wrapper used by proxy.ts. */
export async function verifySessionCookieAsync(cookie: string): Promise<boolean> {
  return (await decodeSessionCookie(cookie)) !== null;
}

export const SESSION_COOKIE_MAX_AGE = COOKIE_MAX_AGE_S;
