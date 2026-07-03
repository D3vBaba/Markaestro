import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so mocks are available inside the vi.mock factory
const { mockCollection, mockRunTransaction, firestoreState } = vi.hoisted(() => {
  const store: Record<string, Record<string, unknown>> = {};
  const mockDoc = vi.fn((id: string) => id);
  const mockCollection = vi.fn(() => ({ doc: mockDoc }));
  const mockRunTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: vi.fn(async (ref: string) => {
        const data = store[ref];
        return { exists: !!data, data: () => data ?? null };
      }),
      set: vi.fn((ref: string, data: Record<string, unknown>) => {
        store[ref] = data;
      }),
      update: vi.fn((ref: string, data: Record<string, unknown>) => {
        if (store[ref]) store[ref] = { ...store[ref], ...data };
      }),
      delete: vi.fn((ref: string) => {
        delete store[ref];
      }),
    };
    return fn(tx);
  });
  return { mockCollection, mockRunTransaction, firestoreState: store };
});

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: mockCollection,
    runTransaction: mockRunTransaction,
  },
}));

import { createOtp, verifyOtp } from '../auth-otp';

const EMAIL = 'user@example.com';

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(firestoreState)) {
    delete firestoreState[key];
  }
});

describe('createOtp', () => {
  it('returns a 6-digit code and stores only a hash', async () => {
    const code = await createOtp('sign-in', EMAIL);

    expect(code).toMatch(/^\d{6}$/);
    const [doc] = Object.values(firestoreState);
    expect(doc).toBeDefined();
    expect(doc.codeHash).not.toContain(code);
    expect(doc.attempts).toBe(0);
  });

  it('enforces the resend cooldown', async () => {
    await createOtp('sign-in', EMAIL);
    await expect(createOtp('sign-in', EMAIL)).rejects.toThrow('OTP_COOLDOWN');
  });

  it('scopes codes to (purpose, email)', async () => {
    await createOtp('sign-in', EMAIL);
    // Different purpose and different email are separate docs — no cooldown.
    await createOtp('email-change:uid1', EMAIL);
    await createOtp('sign-in', 'other@example.com');
    expect(Object.keys(firestoreState)).toHaveLength(3);
  });
});

describe('verifyOtp', () => {
  it('accepts the correct code and consumes it', async () => {
    const code = await createOtp('sign-in', EMAIL);

    await expect(verifyOtp('sign-in', EMAIL, code)).resolves.toBeUndefined();
    // Consumed — a second use fails.
    await expect(verifyOtp('sign-in', EMAIL, code)).rejects.toThrow('OTP_INVALID');
  });

  it('rejects a wrong code and counts the attempt', async () => {
    const code = await createOtp('sign-in', EMAIL);
    const wrong = code === '000000' ? '111111' : '000000';

    await expect(verifyOtp('sign-in', EMAIL, wrong)).rejects.toThrow('OTP_INVALID');
    const [doc] = Object.values(firestoreState);
    expect(doc.attempts).toBe(1);
  });

  it('locks after too many failed attempts, even with the right code', async () => {
    const code = await createOtp('sign-in', EMAIL);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      await expect(verifyOtp('sign-in', EMAIL, wrong)).rejects.toThrow('OTP_INVALID');
    }
    await expect(verifyOtp('sign-in', EMAIL, code)).rejects.toThrow('OTP_TOO_MANY_ATTEMPTS');
    // The doc is destroyed on lockout.
    expect(Object.keys(firestoreState)).toHaveLength(0);
  });

  it('rejects an expired code', async () => {
    const code = await createOtp('sign-in', EMAIL);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    try {
      await expect(verifyOtp('sign-in', EMAIL, code)).rejects.toThrow('OTP_EXPIRED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not verify a code across purposes', async () => {
    const code = await createOtp('email-change:uid1', EMAIL);
    await expect(verifyOtp('sign-in', EMAIL, code)).rejects.toThrow('OTP_INVALID');
  });
});
