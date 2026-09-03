import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/intelligence/ai-gateway', () => ({ generateStructured: vi.fn() }));

import {
  capImportedKnowledge,
  mergeImportedKnowledge,
  selectKnowledgePages,
} from '@/lib/products/knowledge-import';

const HOME = new URL('https://acme.example/');

describe('selectKnowledgePages', () => {
  it('puts the home page first and ranks about, pricing, products above the rest', () => {
    const pages = selectKnowledgePages(
      [
        'https://acme.example/blog/post-1',
        'https://acme.example/faq',
        'https://acme.example/pricing',
        'https://acme.example/about',
        'https://acme.example/products',
        'https://acme.example/team',
        'https://acme.example/#top',
        'https://other.example/about',
        '/customers',
        'mailto:hi@acme.example',
      ],
      HOME,
    );
    expect(pages[0]).toBe('https://acme.example/');
    expect(pages.slice(1, 4)).toEqual([
      'https://acme.example/about',
      'https://acme.example/pricing',
      'https://acme.example/products',
    ]);
    expect(pages).not.toContain('https://acme.example/blog/post-1');
    expect(pages).not.toContain('https://other.example/about');
    expect(pages.length).toBeLessThanOrEqual(6);
  });

  it('dedupes trailing slashes and query strings, preferring shallow paths', () => {
    const pages = selectKnowledgePages(
      ['https://acme.example/pricing/', 'https://acme.example/pricing?ref=nav', 'https://acme.example/pricing/enterprise'],
      HOME,
    );
    expect(pages).toEqual(['https://acme.example/', 'https://acme.example/pricing/', 'https://acme.example/pricing/enterprise']);
  });

  it('reads at most two pages of one kind so breadth wins over depth', () => {
    const links = ['a', 'b', 'c', 'd'].map((c) => `https://acme.example/collections/${c}`)
      .concat('https://acme.example/faq');
    const pages = selectKnowledgePages(links, HOME);
    expect(pages.filter((p) => p.includes('/collections/'))).toHaveLength(2);
    expect(pages).toContain('https://acme.example/faq');
  });

  it('honors the page cap', () => {
    const links = ['about', 'pricing', 'products', 'why', 'customers', 'faq', 'team'].map((p) => `https://acme.example/${p}`);
    expect(selectKnowledgePages(links, HOME, 3)).toHaveLength(3);
  });
});

describe('capImportedKnowledge', () => {
  it('trims to schema limits and drops empty entries', () => {
    const long = 'x'.repeat(2000);
    const out = capImportedKnowledge({
      features: [
        { title: '  Fast  ', description: long, benefit: '' },
        { title: '', description: 'ignored', benefit: '' },
      ],
      usps: Array.from({ length: 15 }, (_, i) => `usp ${i}`),
      painPoints: ['', '  '],
      proofPoints: [{ type: 'stat', content: '', source: '' }, { type: 'award', content: 'Best 2026', source: 'Press' }],
      competitors: [],
      differentiators: [],
      positioning: long,
      targetAudienceDemographics: '',
      targetAudiencePsychographics: '',
      targetAudiencePainStatement: '',
      targetAudienceDesiredOutcome: '',
      contentAngles: ['angles'],
    });
    expect(out.features).toHaveLength(1);
    expect(out.features?.[0].title).toBe('Fast');
    expect(out.features?.[0].description?.length).toBe(500);
    expect(out.usps).toHaveLength(10);
    expect(out.painPoints).toEqual([]);
    expect(out.proofPoints).toEqual([{ type: 'award', content: 'Best 2026', source: 'Press' }]);
    expect(out.positioning?.length).toBe(1000);
  });
});

describe('mergeImportedKnowledge', () => {
  const existing = { usps: ['hand written'], positioning: '', competitors: [] };
  const imported = { usps: ['imported'], positioning: 'Imported positioning', competitors: [] as string[] };

  it('fills only empty fields by default', () => {
    expect(mergeImportedKnowledge(existing, imported, false)).toEqual({
      usps: ['hand written'],
      positioning: 'Imported positioning',
      competitors: [],
    });
  });

  it('replaces filled fields when overwriting, but never with empty values', () => {
    expect(mergeImportedKnowledge(existing, imported, true)).toEqual({
      usps: ['imported'],
      positioning: 'Imported positioning',
      competitors: [],
    });
  });
});
