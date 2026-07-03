/**
 * Firestore-backed one-time sign-in codes (email OTP).
 *
 * Each active code is a single doc in `_authOtps/{docId}` where docId is a
 * hash of `${purpose}:${email}` — so there is at most one live code per
 * (purpose, email) pair and re-requesting replaces the previous code.
 *
 * Only the salted hash of the code is stored. Docs are deleted on successful
 * verification; set a Firestore TTL policy on `expiresAt` to auto-clean the
 * rest (same as `_rateLimits`).
 */

import crypto from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

export type OtpPurpose = 'sign-in' | `email-change:${string}`;

function otpDocRef(purpose: OtpPurpose, email: string) {
  const docId = crypto
    .createHash('sha256')
    .update(`${purpose}:${email.trim().toLowerCase()}`)
    .digest('hex');
  return adminDb.collection('_authOtps').doc(docId);
}

function hashCode(code: string, salt: string): string {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

/** Cryptographically random n-digit code, no leading-zero bias. */
function generateCode(): string {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/**
 * Create (or replace) the one-time code for (purpose, email).
 * Throws OTP_COOLDOWN when the previous code was sent under a minute ago.
 * Returns the plaintext code — caller is responsible for emailing it.
 */
export async function createOtp(purpose: OtpPurpose, email: string): Promise<string> {
  const ref = otpDocRef(purpose, email);
  const code = generateCode();
  const salt = crypto.randomBytes(16).toString('hex');
  const now = Date.now();

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const lastSentAt = (snap.data()?.lastSentAt as Timestamp | undefined)?.toMillis() ?? 0;
    if (snap.exists && now - lastSentAt < RESEND_COOLDOWN_MS) {
      throw new Error('OTP_COOLDOWN');
    }
    tx.set(ref, {
      codeHash: hashCode(code, salt),
      salt,
      attempts: 0,
      lastSentAt: Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(now + CODE_TTL_MS),
    });
  });

  return code;
}

/**
 * Verify a submitted code. Consumes the doc on success; counts failed
 * attempts and locks after MAX_ATTEMPTS. Throws OTP_INVALID / OTP_EXPIRED /
 * OTP_TOO_MANY_ATTEMPTS.
 */
export async function verifyOtp(purpose: OtpPurpose, email: string, code: string): Promise<void> {
  const ref = otpDocRef(purpose, email);
  const submitted = code.replace(/\D/g, '');

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('OTP_INVALID');

    const data = snap.data() as {
      codeHash: string;
      salt: string;
      attempts: number;
      expiresAt: Timestamp;
    };

    if (data.expiresAt.toMillis() < Date.now()) {
      tx.delete(ref);
      throw new Error('OTP_EXPIRED');
    }
    if (data.attempts >= MAX_ATTEMPTS) {
      tx.delete(ref);
      throw new Error('OTP_TOO_MANY_ATTEMPTS');
    }

    const expected = Buffer.from(data.codeHash, 'hex');
    const actual = Buffer.from(hashCode(submitted, data.salt), 'hex');
    const matches =
      submitted.length === CODE_LENGTH &&
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual);

    if (!matches) {
      tx.update(ref, { attempts: data.attempts + 1 });
      throw new Error('OTP_INVALID');
    }

    tx.delete(ref);
  });
}
