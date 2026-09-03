import { beforeEach, describe, expect, it, vi } from 'vitest';

const requirePublicApiContextMock = vi.fn();
vi.mock('@/lib/public-api/auth', () => ({
  requirePublicApiContext: requirePublicApiContextMock,
}));

describe('POST /api/public/v1/mcp without a credential', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePublicApiContextMock.mockRejectedValue(new Error('UNAUTHENTICATED'));
  });

  it('answers 401 with the RFC 9728 challenge that starts the OAuth flow', async () => {
    const { POST } = await import('./route');
    const res = await POST(new Request('https://markaestro.com/api/public/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    }));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer realm="markaestro", resource_metadata="https://markaestro.com/.well-known/oauth-protected-resource/api/public/v1/mcp"',
    );
    expect(await res.json()).toMatchObject({ error: 'UNAUTHENTICATED' });
  });

  it('names the forwarded host in the challenge when a proxy is in front', async () => {
    const { GET } = await import('./route');
    const res = await GET(new Request('http://10.0.0.1:8080/api/public/v1/mcp', {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'markaestro.com' },
    }));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('https://markaestro.com/.well-known/');
  });

  it('does not attach the challenge to other failures', async () => {
    requirePublicApiContextMock.mockRejectedValue(new Error('FORBIDDEN'));
    const { POST } = await import('./route');
    const res = await POST(new Request('https://markaestro.com/api/public/v1/mcp', { method: 'POST' }));
    expect(res.status).not.toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
  });
});
