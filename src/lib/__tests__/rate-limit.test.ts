import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so mocks are available inside the vi.mock factory
const { mockDoc, mockCollection, mockRunTransaction, firestoreState } = vi.hoisted(() => {
  const store: Record<string, { count: number; expiresAt: Date }> = {};
  const mockDoc = vi.fn((id: string) => id);
  const mockCollection = vi.fn(() => ({ doc: mockDoc }));
  const mockRunTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: vi.fn(async (ref: string) => {
        const data = store[ref];
        return { exists: !!data, data: () => data ?? null };
      }),
      set: vi.fn((ref: string, data: { count: number; expiresAt: Date }) => {
        store[ref] = data;
      }),
      update: vi.fn((ref: string, data: { count: number }) => {
        if (store[ref]) store[ref] = { ...store[ref], ...data };
      }),
    };
    return fn(tx);
  });
  return {
    mockDoc,
    mockCollection,
    mockRunTransaction,
    firestoreState: store,
  };
});

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: mockCollection,
    runTransaction: mockRunTransaction,
  },
}));

import { checkRateLimit, RATE_LIMITS, applyRateLimit } from '../rate-limit';
import type { RateLimitConfig } from '../rate-limit';

beforeEach(() => {
  vi.clearAllMocks();
  // Clear the shared store
  for (const key of Object.keys(firestoreState)) {
    delete firestoreState[key];
  }
});

describe('checkRateLimit', () => {
  const config: RateLimitConfig = { limit: 3, windowMs: 60_000 };

  it('allows the first request and sets count to 1', async () => {
    const result = await checkRateLimit('test-key', config);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
    expect(result.limit).toBe(3);
  });

  it('allows requests within the limit', async () => {
    // Simulate existing doc with count=2
    const windowId = Math.floor(Date.now() / config.windowMs);
    const docId = Buffer.from(`test-key:${windowId}`).toString('base64url');
    firestoreState[docId] = { count: 2, expiresAt: new Date(Date.now() + 60_000) };

    const result = await checkRateLimit('test-key', config);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0); // 3 - 3 = 0
  });

  it('rejects requests over the limit', async () => {
    const windowId = Math.floor(Date.now() / config.windowMs);
    const docId = Buffer.from(`test-key:${windowId}`).toString('base64url');
    firestoreState[docId] = { count: 3, expiresAt: new Date(Date.now() + 60_000) };

    const result = await checkRateLimit('test-key', config);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('uses correct Firestore collection', async () => {
    await checkRateLimit('any-key', config);
    expect(mockCollection).toHaveBeenCalledWith('_rateLimits');
  });

  it('encodes key as base64url doc ID', async () => {
    await checkRateLimit('ip:1.2.3.4:/api/ai/generate', config);
    expect(mockDoc).toHaveBeenCalledOnce();
    const docId = mockDoc.mock.calls[0][0];
    // Should be valid base64url (no +, /, or =)
    expect(docId).not.toMatch(/[+/=]/);
  });

  it('resets count in a new window', async () => {
    // Set up count=3 in the current window
    const windowId = Math.floor(Date.now() / config.windowMs);
    const docId = Buffer.from(`test-key:${windowId}`).toString('base64url');
    firestoreState[docId] = { count: 3, expiresAt: new Date(Date.now() + 60_000) };

    // This key should be blocked
    const result = await checkRateLimit('test-key', config);
    expect(result.allowed).toBe(false);

    // Different key should be allowed (separate counter)
    const result2 = await checkRateLimit('other-key', config);
    expect(result2.allowed).toBe(true);
  });
});

describe('RATE_LIMITS', () => {
  it('has the expected tiers', () => {
    expect(RATE_LIMITS.auth).toEqual({ limit: 10, windowMs: 60_000 });
    expect(RATE_LIMITS.api).toEqual({ limit: 60, windowMs: 60_000 });
    expect(RATE_LIMITS.ai).toEqual({ limit: 10, windowMs: 60_000 });
    expect(RATE_LIMITS.worker).toEqual({ limit: 5, windowMs: 60_000 });
  });
});

describe('applyRateLimit', () => {
  it('returns headers when request is allowed', async () => {
    const req = new Request('https://app.com/api/ai/generate', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });

    const { headers } = await applyRateLimit(req, { limit: 10, windowMs: 60_000 });

    expect(headers['X-RateLimit-Limit']).toBe('10');
    expect(headers['X-RateLimit-Remaining']).toBeDefined();
    expect(headers['X-RateLimit-Reset']).toBeDefined();
  });

  it('throws a 429 Response when rate limited', async () => {
    const config: RateLimitConfig = { limit: 1, windowMs: 60_000 };

    // First request succeeds
    const req1 = new Request('https://app.com/api/test', {
      headers: { 'x-forwarded-for': '9.9.9.9' },
    });
    await applyRateLimit(req1, config);

    // Second request should be blocked
    const req2 = new Request('https://app.com/api/test', {
      headers: { 'x-forwarded-for': '9.9.9.9' },
    });

    try {
      await applyRateLimit(req2, config);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const res = error as Response;
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe('RATE_LIMITED');
      expect(body.retryAfter).toBeGreaterThan(0);
      expect(res.headers.get('Retry-After')).toBeDefined();
    }
  });

  it('extracts IP from x-forwarded-for (first entry only)', async () => {
    const req = new Request('https://app.com/api/test', {
      headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' },
    });

    await applyRateLimit(req, { limit: 100, windowMs: 60_000 });

    const docId = mockDoc.mock.calls[0][0];
    const decoded = Buffer.from(docId, 'base64url').toString();
    expect(decoded).toContain('10.0.0.1');
    expect(decoded).not.toContain('192.168.1.1');
  });

  it('falls back to x-real-ip', async () => {
    const req = new Request('https://app.com/api/test', {
      headers: { 'x-real-ip': '172.16.0.1' },
    });

    await applyRateLimit(req, { limit: 100, windowMs: 60_000 });

    const docId = mockDoc.mock.calls[0][0];
    const decoded = Buffer.from(docId, 'base64url').toString();
    expect(decoded).toContain('172.16.0.1');
  });

  it('uses "unknown" when no IP headers present', async () => {
    const req = new Request('https://app.com/api/test');

    await applyRateLimit(req, { limit: 100, windowMs: 60_000 });

    const docId = mockDoc.mock.calls[0][0];
    const decoded = Buffer.from(docId, 'base64url').toString();
    expect(decoded).toContain('unknown');
  });
});
