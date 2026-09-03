import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const PROXY = join(ROOT, 'hosting-proxy/server.js');

describe('hosting-proxy response header allowlist', () => {
  const src = readFileSync(PROXY, 'utf8');

  it('forwards Link and X-Robots-Tag so hreflang and noindex reach clients', () => {
    expect(src).toMatch(/'link'/);
    expect(src).toMatch(/'x-robots-tag'/);
  });

  it('keeps app HTML private and allows a short public cache for apex HTML', () => {
    expect(src).toMatch(/APP_HTML_CACHE_CONTROL/);
    expect(src).toMatch(/MARKETING_HTML_CACHE_CONTROL/);
    expect(src).toMatch(/private, no-cache, no-store/);
    expect(src).toMatch(/public, max-age=60/);
  });
});
