import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/r/[code]` ran its whole handler body outside any `try`. A Firestore read
 * failure escaped as a framework 500 with no requestId and a body the client
 * could not parse, which turns a customer's tracked link into a broken page
 * for a real person who has never heard of us.
 *
 * The redirect is the product: it must degrade to something readable, never
 * to a stack trace.
 */

const docGetMock = vi.fn();
const afterCallbacks: Array<() => Promise<void> | void> = [];
const errorLogMock = vi.fn();
const recordTrackedLinkClickMock = vi.fn(async () => undefined);
const docSetMock = vi.fn(async () => undefined);

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: (callback: () => Promise<void> | void) => { afterCallbacks.push(callback); },
  };
});

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: (path: string) => (path.startsWith('conversionClicks/')
      ? { set: docSetMock }
      : { get: () => docGetMock(path) }),
  },
}));

vi.mock('@/lib/intelligence/conversions', () => ({
  createClickId: () => 'click_1',
  appendClickId: (destination: string) => `${destination}?mk_cid=click_1`,
  recordTrackedLinkClick: recordTrackedLinkClickMock,
}));

vi.mock('@/lib/intelligence/bot-filter', () => ({
  CLICK_DEDUPE_WINDOW_MS: 30_000,
  classifyUserAgent: () => 'human',
  clickDedupeKey: () => 'dedupe-key',
  clientIpFromHeaders: () => 'ip-hash',
}));

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { redirect: { limit: 60, windowMs: 60_000 } },
  checkRateLimit: async () => ({ allowed: true }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: errorLogMock, critical: vi.fn() },
}));

function request(code: string) {
  return new Request(`https://app.example.com/r/${code}`, {
    headers: { 'user-agent': 'Mozilla/5.0' },
  });
}

function params(code: string) {
  return { params: Promise.resolve({ code }) };
}

function linkDoc(data: Record<string, unknown>) {
  return { exists: true, data: () => data };
}

const LINK = {
  destination: 'https://customer.example.com/launch',
  workspaceId: 'ws1',
  productId: 'brand1',
  active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  vi.resetModules();
});

describe('GET /r/[code]', () => {
  it('redirects to the destination with a click id attached', async () => {
    docGetMock.mockResolvedValue(linkDoc(LINK));
    const { GET } = await import('@/app/r/[code]/route');

    const response = await GET(request('abc'), params('abc'));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://customer.example.com/launch?mk_cid=click_1',
    );
  });

  it('sends the visitor to an explanation page when the lookup fails', async () => {
    docGetMock.mockRejectedValue(new Error('firestore unavailable'));
    const { GET } = await import('@/app/r/[code]/route');

    const response = await GET(request('boom'), params('boom'));

    // Not a 500 with an unparseable body: a real person is looking at this.
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('/link-unavailable');
    expect(errorLogMock).toHaveBeenCalledWith(
      expect.stringContaining('tracked link redirect failed'),
      expect.objectContaining({ event: 'intelligence.redirect_failed' }),
    );
  });

  it('serves a recently used link from cache, so a Firestore blip is a non-event', async () => {
    docGetMock.mockResolvedValueOnce(linkDoc(LINK));
    const { GET } = await import('@/app/r/[code]/route');

    await GET(request('cached'), params('cached'));
    docGetMock.mockRejectedValue(new Error('firestore unavailable'));
    const second = await GET(request('cached'), params('cached'));

    expect(second.status).toBe(302);
    expect(second.headers.get('location')).toContain('customer.example.com');
    expect(docGetMock).toHaveBeenCalledOnce();
  });

  it('still 404s a code that does not exist', async () => {
    docGetMock.mockResolvedValue({ exists: false, data: () => undefined });
    const { GET } = await import('@/app/r/[code]/route');

    const response = await GET(request('nope'), params('nope'));
    expect(response.status).toBe(404);
  });

  it('honours a deactivated link', async () => {
    docGetMock.mockResolvedValue(linkDoc({ ...LINK, active: false }));
    const { GET } = await import('@/app/r/[code]/route');

    const response = await GET(request('off'), params('off'));
    expect(response.status).toBe(404);
  });

  it('does not let a failed click write become an unhandled rejection', async () => {
    docGetMock.mockResolvedValue(linkDoc(LINK));
    docSetMock.mockRejectedValue(new Error('write failed'));
    const { GET } = await import('@/app/r/[code]/route');

    await GET(request('write-fail'), params('write-fail'));

    expect(afterCallbacks).toHaveLength(1);
    // The conversionClicks write had no catch of its own, so a failure here
    // took the counter update down with it.
    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
    expect(errorLogMock).toHaveBeenCalledWith(
      expect.stringContaining('tracked link click write failed'),
      expect.objectContaining({ event: 'intelligence.click_write_failed' }),
    );
    expect(recordTrackedLinkClickMock).toHaveBeenCalled();
  });
});
