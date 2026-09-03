import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  BRAND_JSON_SCHEMA,
  extractBrandWithCloudflare,
  getCloudflareScanConfig,
  normalizeCloudflareBrand,
  renderHtmlWithCloudflare,
} from '@/lib/products/cloudflare-scan';

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-browser-ms-used': '4200' },
    ...init,
  });

describe('normalizeCloudflareBrand', () => {
  it('keeps valid enum values and trims free text', () => {
    const brand = normalizeCloudflareBrand({
      name: '  Acme Coffee  ',
      description: 'Small-batch roaster in Lisbon.   Ships across Europe.',
      category: 'Food-Restaurant',
      pricingTier: 'Subscription',
      tags: ['Coffee', 'roasting', 'coffee', '  ', 'lisbon', 'a', 'b', 'c', 'd'],
      targetAudience: 'Home brewers who care about origin.',
      tone: 'warm, direct',
    });
    expect(brand).toEqual({
      name: 'Acme Coffee',
      description: 'Small-batch roaster in Lisbon. Ships across Europe.',
      category: 'food-restaurant',
      pricingTier: 'subscription',
      tags: ['coffee', 'roasting', 'lisbon', 'a', 'b', 'c'],
      targetAudience: 'Home brewers who care about origin.',
      tone: 'warm, direct',
    });
  });

  it('drops enum values the product schema does not know', () => {
    const brand = normalizeCloudflareBrand({
      name: 'X',
      category: 'blockchain',
      pricingTier: 'cheap',
      tags: 'not-an-array',
    });
    expect(brand?.category).toBe('');
    expect(brand?.pricingTier).toBe('');
    expect(brand?.tags).toEqual([]);
  });

  it('rejects a result that read a bot challenge page', () => {
    expect(normalizeCloudflareBrand({
      name: 'example.org',
      description: 'This website uses a security service to protect against malicious bots.',
      category: 'other',
      tags: [],
    })).toBeNull();
  });

  it('returns null for empty or malformed results', () => {
    expect(normalizeCloudflareBrand(null)).toBeNull();
    expect(normalizeCloudflareBrand('text')).toBeNull();
    expect(normalizeCloudflareBrand([])).toBeNull();
    expect(normalizeCloudflareBrand({ name: '', tags: [], tone: '' })).toBeNull();
    expect(normalizeCloudflareBrand({ name: '', description: '', category: 'other', pricingTier: 'free', tags: [] })).toBeNull();
  });
});

describe('Cloudflare quick actions', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-123';
    process.env.CLOUDFLARE_API_TOKEN = 'token-abc';
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
  });

  it('is disabled without both account id and token', async () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    expect(getCloudflareScanConfig()).toBeNull();
    expect(await extractBrandWithCloudflare('https://example.com')).toBeNull();
    expect(await renderHtmlWithCloudflare('https://example.com')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls /json with the brand schema and normalizes the result', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        result: {
          name: 'Acme',
          description: 'Acme makes anvils.',
          category: 'ecommerce',
          pricingTier: 'paid',
          tags: ['anvils'],
          targetAudience: 'Coyotes.',
          tone: 'dry, playful',
        },
      }),
    );

    const brand = await extractBrandWithCloudflare('https://acme.example');
    expect(brand?.name).toBe('Acme');
    expect(brand?.category).toBe('ecommerce');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct-123/browser-rendering/json');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-abc');
    const body = JSON.parse(String(init?.body));
    expect(body.url).toBe('https://acme.example');
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: BRAND_JSON_SCHEMA });
    expect(typeof body.prompt).toBe('string');
    expect(body.gotoOptions.waitUntil).toBe('load');
    expect(body.waitForTimeout).toBe(1500);
  });

  it('returns null when Cloudflare reports failure', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, errors: [{ code: 1, message: 'nope' }] }, { status: 400 }),
    );
    expect(await extractBrandWithCloudflare('https://acme.example')).toBeNull();
  });

  it('retries once after a 429, honoring Retry-After', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { success: false, errors: [{ code: 2001, message: 'Rate limit exceeded' }] },
          { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true, result: { name: 'Acme', tags: [] } }));
    const brand = await extractBrandWithCloudflare('https://acme.example');
    expect(brand?.name).toBe('Acme');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second 429', async () => {
    const limited = () =>
      jsonResponse(
        { success: false, errors: [{ code: 2001, message: 'Rate limit exceeded' }] },
        { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' } },
      );
    fetchMock.mockResolvedValueOnce(limited()).mockResolvedValueOnce(limited());
    expect(await extractBrandWithCloudflare('https://acme.example')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when the network call throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect(await extractBrandWithCloudflare('https://acme.example')).toBeNull();
  });

  it('unwraps rendered HTML from the /content envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, result: '<html><head><title>Acme</title></head><body></body></html>' }),
    );
    const html = await renderHtmlWithCloudflare('https://acme.example');
    expect(html).toContain('<title>Acme</title>');
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/browser-rendering\/content$/);
  });

  it('treats a rendered challenge page as no render', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, result: '<html><head><title>Just a moment...</title></head><body></body></html>' }),
    );
    expect(await renderHtmlWithCloudflare('https://acme.example')).toBeNull();
  });

  it('accepts raw HTML from /content and rejects non-documents', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<!doctype html><html><body>hi</body></html>', {
        headers: { 'content-type': 'text/html' },
      }),
    );
    expect(await renderHtmlWithCloudflare('https://acme.example')).toContain('<body>hi</body>');

    fetchMock.mockResolvedValueOnce(
      new Response('not a page', { headers: { 'content-type': 'text/plain' } }),
    );
    expect(await renderHtmlWithCloudflare('https://acme.example')).toBeNull();
  });
});
