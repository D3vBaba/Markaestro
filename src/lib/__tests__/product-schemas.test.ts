import { describe, expect, it } from 'vitest';
import {
  brandIdentitySchema,
  createProductSchema,
  updateProductSchema,
} from '@/lib/schemas';

describe('updateProductSchema website URL', () => {
  it('accepts an empty website', () => {
    expect(updateProductSchema.parse({ url: '' }).url).toBe('');
    expect(updateProductSchema.parse({ url: '   ' }).url).toBe('');
  });

  it('keeps an already-valid https URL', () => {
    expect(updateProductSchema.parse({ url: 'https://acme.com/about' }).url).toBe(
      'https://acme.com/about',
    );
  });

  it('prepends https:// when the user omits a scheme', () => {
    expect(updateProductSchema.parse({ url: 'acme.com' }).url).toBe('https://acme.com');
    expect(updateProductSchema.parse({ url: 'www.acme.com/pricing' }).url).toBe(
      'https://www.acme.com/pricing',
    );
  });

  it('rejects javascript and other non-http schemes', () => {
    expect(updateProductSchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
    expect(updateProductSchema.safeParse({ url: 'mailto:hi@acme.com' }).success).toBe(false);
  });
});

describe('createProductSchema website URL', () => {
  it('prepends https:// on create the same way as update', () => {
    const parsed = createProductSchema.parse({
      name: 'Acme',
      url: 'acme.com',
      categories: ['saas'],
    });
    expect(parsed.url).toBe('https://acme.com');
  });
});

describe('updateProductSchema categories', () => {
  it('keeps a valid category', () => {
    expect(updateProductSchema.parse({ categories: ['personal-brand'] }).categories).toEqual([
      'personal-brand',
    ]);
  });

  it('coerces a legacy string category into an array', () => {
    expect(updateProductSchema.parse({ categories: 'fitness' as never }).categories).toEqual([
      'fitness',
    ]);
  });

  it('maps unknown categories to other so a name/url edit can still save', () => {
    expect(updateProductSchema.parse({ categories: ['software'] }).categories).toEqual(['other']);
  });

  it('defaults an empty list to saas', () => {
    expect(updateProductSchema.parse({ categories: [] }).categories).toEqual(['saas']);
  });
});

describe('brandIdentitySchema colors and logo', () => {
  it('accepts empty colors', () => {
    expect(
      brandIdentitySchema.parse({
        logoUrl: '',
        primaryColor: '',
        secondaryColor: '',
        accentColor: '',
      }),
    ).toEqual({
      logoUrl: '',
      primaryColor: '',
      secondaryColor: '',
      accentColor: '',
    });
  });

  it('expands 3-digit hex and missing # so identity save does not fail', () => {
    expect(
      brandIdentitySchema.parse({
        logoUrl: '',
        primaryColor: '#fff',
        secondaryColor: '2563eb',
        accentColor: '#ABC',
      }),
    ).toEqual({
      logoUrl: '',
      primaryColor: '#FFFFFF',
      secondaryColor: '#2563EB',
      accentColor: '#AABBCC',
    });
  });

  it('rejects non-hex color text', () => {
    expect(
      brandIdentitySchema.safeParse({
        logoUrl: '',
        primaryColor: 'blue',
        secondaryColor: '',
        accentColor: '',
      }).success,
    ).toBe(false);
  });

  it('accepts a long scanned logo URL', () => {
    const logoUrl = `https://cdn.example.com/assets/${'a'.repeat(2500)}.svg`;
    expect(brandIdentitySchema.parse({
      logoUrl,
      primaryColor: '',
      secondaryColor: '',
      accentColor: '',
    }).logoUrl).toBe(logoUrl);
  });
});
