/**
 * Tests for ProductKnowledge schema validation and enrichment text utilities.
 *
 * The AI extraction call (enrichProductKnowledgeFromUrl) is not tested here
 * because it requires live network access and API keys. Instead we test:
 *   - productKnowledgeSchema: all field constraints and defaults
 *   - extractVisibleText: HTML parsing and text extraction
 *   - findFeaturesPage: features URL discovery
 */
import { describe, expect, it } from 'vitest';
import {
  productKnowledgeSchema,
  proofPointSchema,
  productFeatureSchema,
} from '../schemas';
import { extractVisibleText, findFeaturesPage } from '../products/enrich';

// ── productKnowledgeSchema ────────────────────────────────────────────

describe('productKnowledgeSchema', () => {
  it('parses a complete valid knowledge object', () => {
    const result = productKnowledgeSchema.parse({
      features: [{ title: 'Fast sync', description: 'Syncs in real time', benefit: 'No lag' }],
      usps: ['10x faster than alternatives'],
      painPoints: ['Wasted hours on manual work'],
      proofPoints: [{ type: 'stat', content: '50% faster', source: 'Internal study' }],
      targetAudienceDemographics: 'Founders aged 25-40',
      targetAudiencePsychographics: 'Growth-focused, tech-savvy',
      targetAudiencePainStatement: 'I waste hours on repetitive tasks',
      targetAudienceDesiredOutcome: 'Automate my workflow and reclaim my time',
      competitors: ['Competitor A'],
      differentiators: ['Unlike A, we do X'],
      positioning: 'The fastest tool for solo founders.',
      productImages: ['https://example.com/image.png'],
      contentAngles: ['Before/after showing old vs new workflow'],
      lastEnrichedAt: '2026-01-01T00:00:00.000Z',
      enrichmentSource: 'url_import',
    });

    expect(result.features).toHaveLength(1);
    expect(result.features[0].title).toBe('Fast sync');
    expect(result.usps).toEqual(['10x faster than alternatives']);
    expect(result.enrichmentSource).toBe('url_import');
  });

  it('applies defaults for all optional arrays and strings', () => {
    const result = productKnowledgeSchema.parse({});
    expect(result.features).toEqual([]);
    expect(result.usps).toEqual([]);
    expect(result.painPoints).toEqual([]);
    expect(result.proofPoints).toEqual([]);
    expect(result.competitors).toEqual([]);
    expect(result.differentiators).toEqual([]);
    expect(result.productImages).toEqual([]);
    expect(result.contentAngles).toEqual([]);
    expect(result.targetAudienceDemographics).toBe('');
    expect(result.positioning).toBe('');
  });

  it('rejects invalid enrichmentSource values', () => {
    expect(() => productKnowledgeSchema.parse({ enrichmentSource: 'scraper' })).toThrow();
  });

  it('rejects features exceeding the 20-item limit', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      title: `Feature ${i}`,
      description: '',
      benefit: '',
    }));
    expect(() => productKnowledgeSchema.parse({ features: tooMany })).toThrow();
  });

  it('accepts exactly 20 features', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({
      title: `Feature ${i}`,
    }));
    const result = productKnowledgeSchema.parse({ features: twenty });
    expect(result.features).toHaveLength(20);
  });

  it('rejects non-URL strings in productImages', () => {
    expect(() => productKnowledgeSchema.parse({ productImages: ['not-a-url'] })).toThrow();
  });

  it('rejects productImages exceeding 10 items', () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}.png`);
    expect(() => productKnowledgeSchema.parse({ productImages: urls })).toThrow();
  });

  it('rejects lastEnrichedAt non-datetime values', () => {
    expect(() => productKnowledgeSchema.parse({ lastEnrichedAt: 'yesterday' })).toThrow();
  });
});

describe('proofPointSchema', () => {
  it('accepts all valid proof types', () => {
    for (const type of ['stat', 'testimonial', 'award', 'press'] as const) {
      const result = proofPointSchema.parse({ type, content: 'Some content' });
      expect(result.type).toBe(type);
    }
  });

  it('rejects invalid proof types', () => {
    expect(() => proofPointSchema.parse({ type: 'review', content: 'Good product' })).toThrow();
  });

  it('requires content', () => {
    expect(() => proofPointSchema.parse({ type: 'stat' })).toThrow();
  });

  it('defaults source to empty string', () => {
    const result = proofPointSchema.parse({ type: 'stat', content: 'Value' });
    expect(result.source).toBe('');
  });
});

describe('productFeatureSchema', () => {
  it('requires title', () => {
    expect(() => productFeatureSchema.parse({})).toThrow();
  });

  it('defaults description and benefit to empty strings', () => {
    const result = productFeatureSchema.parse({ title: 'My feature' });
    expect(result.description).toBe('');
    expect(result.benefit).toBe('');
  });

  it('trims whitespace from title', () => {
    const result = productFeatureSchema.parse({ title: '  Fast sync  ' });
    expect(result.title).toBe('Fast sync');
  });
});

// ── extractVisibleText ────────────────────────────────────────────────

describe('extractVisibleText', () => {
  it('extracts text from a simple HTML page', () => {
    const html = '<html><body><p>Hello world</p></body></html>';
    const result = extractVisibleText(html);
    expect(result).toContain('Hello world');
  });

  it('strips script and style tags', () => {
    const html = '<html><body><script>alert(1)</script><style>.x{color:red}</style><p>Visible</p></body></html>';
    const result = extractVisibleText(html);
    expect(result).not.toContain('alert');
    expect(result).not.toContain('color:red');
    expect(result).toContain('Visible');
  });

  it('strips nav, footer, header, and aside tags', () => {
    const html = `<html><body>
      <nav>Navigation links</nav>
      <header>Site header</header>
      <main><p>Main content here</p></main>
      <aside>Sidebar</aside>
      <footer>Footer links</footer>
    </body></html>`;
    const result = extractVisibleText(html);
    expect(result).toContain('Main content here');
    expect(result).not.toContain('Navigation links');
    expect(result).not.toContain('Site header');
    expect(result).not.toContain('Sidebar');
    expect(result).not.toContain('Footer links');
  });

  it('prefers content inside <main> when present', () => {
    const html = `<html><body>
      <p>Outside main</p>
      <main><p>Inside main</p></main>
    </body></html>`;
    const result = extractVisibleText(html);
    expect(result).toContain('Inside main');
    expect(result).not.toContain('Outside main');
  });

  it('extracts h1–h3 headings into a HEADINGS prefix', () => {
    const html = `<main>
      <h1>Product Title</h1>
      <h2>Key Features</h2>
      <p>Some body text</p>
    </main>`;
    const result = extractVisibleText(html);
    expect(result).toMatch(/HEADINGS:.*Product Title/);
    expect(result).toMatch(/Key Features/);
  });

  it('respects the maxChars limit', () => {
    const html = '<p>' + 'x'.repeat(20000) + '</p>';
    const result = extractVisibleText(html, 100);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('returns empty string for empty HTML', () => {
    const result = extractVisibleText('');
    expect(result).toBe('');
  });

  it('decodes &nbsp; and &amp; entities', () => {
    const html = '<p>Hello&nbsp;World &amp; Friends</p>';
    const result = extractVisibleText(html);
    expect(result).toContain('Hello World & Friends');
  });

  it('collapses multiple whitespace characters into one', () => {
    const html = '<p>Too   many    spaces</p>';
    const result = extractVisibleText(html);
    expect(result).not.toMatch(/\s{2,}/);
  });
});

// ── findFeaturesPage ──────────────────────────────────────────────────

describe('findFeaturesPage', () => {
  it('finds a /features href in anchor tags', () => {
    const html = '<nav><a href="/features">Features</a></nav>';
    const result = findFeaturesPage(html, 'https://example.com');
    expect(result).toBe('https://example.com/features');
  });

  it('finds an absolute same-origin features URL', () => {
    const html = '<a href="https://example.com/features/overview">Features</a>';
    const result = findFeaturesPage(html, 'https://example.com');
    expect(result).toBe('https://example.com/features/overview');
  });

  it('rejects cross-origin features links', () => {
    const html = '<a href="https://other.com/features">Features</a>';
    const result = findFeaturesPage(html, 'https://example.com');
    expect(result).toBeNull();
  });

  it('returns null when no features link is found', () => {
    const html = '<nav><a href="/pricing">Pricing</a><a href="/docs">Docs</a></nav>';
    const result = findFeaturesPage(html, 'https://example.com');
    expect(result).toBeNull();
  });

  it('returns null for empty HTML', () => {
    const result = findFeaturesPage('', 'https://example.com');
    expect(result).toBeNull();
  });
});
