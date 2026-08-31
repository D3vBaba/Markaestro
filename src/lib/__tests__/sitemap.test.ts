import { describe, expect, it } from 'vitest';
import sitemap from '@/app/sitemap';

describe('sitemap', () => {
  it('emits nine English locs with xhtml-style language alternates and no /en prefix', () => {
    const entries = sitemap();
    expect(entries).toHaveLength(9);
    for (const entry of entries) {
      expect(entry.url).toMatch(/^https:\/\/markaestro.com(\/|$)/);
      expect(entry.url).not.toContain('/en');
      expect(entry.lastModified).toBeUndefined();
      expect(entry.alternates?.languages?.en).toBe(entry.url);
      expect(entry.alternates?.languages?.['x-default']).toBe(entry.url);
      expect(entry.alternates?.languages?.es).toContain('/es');
    }
    const urls = entries.map((e) => e.url);
    expect(urls).toContain('https://markaestro.com/developers/agents');
    expect(urls).not.toContain('https://markaestro.com/en');
    expect(urls).not.toContain('https://markaestro.com/sitemap-index.xml');
  });
});
