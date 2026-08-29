import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, markAuthReady } from '@/lib/api-client';

/**
 * The contract every call site already assumed and the client did not hold:
 * `apiFetch` resolves to `{ ok, status, data }` for every response, including
 * the ones that are not JSON at all.
 *
 * Before this, a Cloud Run 502, a load-balancer error page, or Next's own
 * HTML 500 made `res.json()` reject, and since every call site destructures
 * the result without a try, that SyntaxError escaped into React instead of
 * rendering as a failed request.
 */

const originalFetch = globalThis.fetch;

function response(body: string, init: ResponseInit & { contentType?: string } = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'Content-Type': init.contentType ?? 'application/json', ...(init.headers || {}) },
  });
}

beforeEach(() => {
  // AuthProvider normally does this; without it every request would await a
  // promise that never resolves.
  markAuthReady();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('apiFetch response parsing', () => {
  it('returns parsed JSON for a normal response', async () => {
    globalThis.fetch = vi.fn(async () => response(JSON.stringify({ id: 'p1' }))) as typeof fetch;

    const result = await apiFetch<{ id: string }>('/api/posts/p1');
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data.id).toBe('p1');
  });

  it('turns an HTML error page into INTERNAL_ERROR rather than throwing', async () => {
    globalThis.fetch = vi.fn(async () => response(
      '<!doctype html><html><body>502 Bad Gateway</body></html>',
      { status: 502, contentType: 'text/html' },
    )) as typeof fetch;

    const result = await apiFetch<{ error: string }>('/api/posts');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.data.error).toBe('INTERNAL_ERROR');
  });

  it('turns an unparseable 200 into MALFORMED_RESPONSE', async () => {
    globalThis.fetch = vi.fn(async () => response('not json at all', {
      status: 200,
      contentType: 'text/plain',
    })) as typeof fetch;

    const result = await apiFetch<{ error: string }>('/api/posts');
    // `ok` still reflects the HTTP status; only the body was unusable.
    expect(result.ok).toBe(true);
    expect(result.data.error).toBe('MALFORMED_RESPONSE');
  });

  it('treats an empty body as a failed parse rather than valid data', async () => {
    globalThis.fetch = vi.fn(async () => response('', { status: 200 })) as typeof fetch;

    const result = await apiFetch<{ error: string }>('/api/posts/p1');
    expect(result.data.error).toBe('MALFORMED_RESPONSE');
  });

  it('does not let a JSON null body masquerade as data', async () => {
    globalThis.fetch = vi.fn(async () => response('null')) as typeof fetch;

    const result = await apiFetch<{ error: string }>('/api/posts');
    expect(result.data.error).toBe('MALFORMED_RESPONSE');
  });
});

describe('apiFetch request id propagation', () => {
  it('sends x-request-id so a reported failure can be found in the logs', async () => {
    const fetchMock = vi.fn(async () => response(JSON.stringify({ ok: true })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await apiFetch('/api/posts');

    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    const sent = (init.headers as Record<string, string>)['x-request-id'];
    expect(sent).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });

  it('keeps the id the server returned in the body', async () => {
    globalThis.fetch = vi.fn(async () => response(
      JSON.stringify({ error: 'NOT_FOUND', requestId: 'server-side-id-0001' }),
      { status: 404 },
    )) as typeof fetch;

    const result = await apiFetch<{ requestId: string }>('/api/posts/nope');
    expect(result.data.requestId).toBe('server-side-id-0001');
  });

  it('falls back to the header id when the body carries none', async () => {
    globalThis.fetch = vi.fn(async () => response(
      '<!doctype html><html><body>504</body></html>',
      { status: 504, contentType: 'text/html', headers: { 'x-request-id': 'edge-minted-id-0001' } },
    )) as typeof fetch;

    const result = await apiFetch<{ requestId: string }>('/api/posts');
    expect(result.data.requestId).toBe('edge-minted-id-0001');
  });
});

describe('apiFetch timeouts', () => {
  it('reports a timeout as a result, not a thrown AbortError', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }) as typeof fetch;

    const result = await apiFetch<{ error: string }>('/api/posts');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(408);
    expect(result.data.error).toBe('REQUEST_TIMEOUT');
  });
});
