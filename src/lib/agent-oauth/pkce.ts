import crypto from 'crypto';
import { safeCompare } from '@/lib/crypto';

/**
 * PKCE (RFC 7636) and token primitives for the agent OAuth flow.
 *
 * Everything here is pure so it can be unit tested without Firestore.
 * The only method supported is S256: `plain` offers nothing over a bare
 * code and OAuth 2.1 drops it.
 */

/** RFC 7636 §4.1: 43 to 128 characters from the unreserved set. */
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
/** A base64url-encoded SHA-256 digest is exactly 43 characters. */
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9\-_]{43}$/;

export function isValidCodeChallenge(challenge: unknown): challenge is string {
  return typeof challenge === 'string' && CODE_CHALLENGE_PATTERN.test(challenge);
}

export function isValidCodeVerifier(verifier: unknown): verifier is string {
  return typeof verifier === 'string' && CODE_VERIFIER_PATTERN.test(verifier);
}

export function s256Challenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/** True when `verifier` is the secret behind `challenge`. */
export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier)) return false;
  return safeCompare(s256Challenge(verifier), challenge);
}

/**
 * Opaque, single-use tokens (authorization codes, refresh tokens) are stored
 * only as hashes, so a Firestore read never yields a usable credential.
 */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
