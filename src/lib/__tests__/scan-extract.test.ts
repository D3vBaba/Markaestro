import { describe, it, expect } from 'vitest';
import {
  cleanDescription,
  collectLogoCandidates,
  extractCssColors,
  extractJsonLdBrand,
  extractLeadParagraph,
  findManifestHref,
  findStylesheetHrefs,
  hexToHsl,
  isBotChallengePage,
  isNeutral,
  looksLikeChallengeText,
  looksTruncated,
  normalizeColor,
  parseManifest,
  pickDescription,
  pickName,
  pickPalette,
} from '@/lib/products/scan-extract';

const BASE = new URL('https://example.com/');
const NO_JSONLD = { name: '', description: '', logo: '' };

describe('normalizeColor', () => {
  it('normalizes 3- and 6-digit hex and strips alpha', () => {
    expect(normalizeColor('#abc')).toBe('#AABBCC');
    expect(normalizeColor('#1a2b3c')).toBe('#1A2B3C');
    expect(normalizeColor('#1a2b3cff')).toBe('#1A2B3C');
  });
  it('normalizes rgb()/rgba()', () => {
    expect(normalizeColor('rgb(255, 0, 128)')).toBe('#FF0080');
    expect(normalizeColor('rgba(0,102,255,0.5)')).toBe('#0066FF');
  });
  it('rejects non-colors', () => {
    expect(normalizeColor('inherit')).toBeNull();
    expect(normalizeColor('url(#x)')).toBeNull();
  });
});

describe('isNeutral', () => {
  it('flags near-white, near-black, and greys', () => {
    expect(isNeutral('#F6F6F8')).toBe(true); // the RevTrakkr background bug
    expect(isNeutral('#FFFFFF')).toBe(true);
    expect(isNeutral('#0A0A0A')).toBe(true);
    expect(isNeutral('#888888')).toBe(true);
  });
  it('keeps saturated brand colors', () => {
    expect(isNeutral('#2563EB')).toBe(false);
    expect(isNeutral('#E1306C')).toBe(false);
  });
});

describe('hexToHsl', () => {
  it('computes saturation and lightness', () => {
    const { s, l } = hexToHsl('#FF0000');
    expect(s).toBeCloseTo(1);
    expect(l).toBeCloseTo(0.5);
  });
});

describe('pickPalette', () => {
  it('drops neutrals and ranks by weight and vividness', () => {
    const palette = pickPalette([
      { hex: '#F6F6F8', weight: 100 }, // background — must never win
      { hex: '#2563EB', weight: 10 },
      { hex: '#F97316', weight: 5 },
    ]);
    expect(palette.primaryColor).toBe('#2563EB');
    expect(palette.secondaryColor).toBe('#F97316');
  });

  it('deduplicates near-identical hues', () => {
    const palette = pickPalette([
      { hex: '#2563EB', weight: 10 },
      { hex: '#2E6BEE', weight: 9 }, // same blue family, same lightness band
      { hex: '#E11D48', weight: 3 },
    ]);
    expect(palette.primaryColor).toBe('#2563EB');
    expect(palette.secondaryColor).toBe('#E11D48');
  });

  it('returns empty strings when only neutrals exist', () => {
    const palette = pickPalette([{ hex: '#FFFFFF', weight: 10 }]);
    expect(palette.primaryColor).toBe('');
    expect(palette.secondaryColor).toBe('');
    expect(palette.accentColor).toBe('');
  });
});

describe('extractCssColors', () => {
  it('weights named brand custom properties above literal frequency', () => {
    const css = `
      :root { --brand-primary: #2563EB; --accent: rgb(249, 115, 22); }
      .a { color: #E11D48; } .b { color: #E11D48; }
    `;
    const colors = extractCssColors(css);
    const byHex = Object.fromEntries(colors.map((c) => [c.hex, c.weight]));
    expect(byHex['#2563EB']).toBeGreaterThan(byHex['#E11D48']);
    expect(byHex['#F97316']).toBeGreaterThan(byHex['#E11D48']);
  });

  it('ignores neutrals entirely', () => {
    const colors = extractCssColors(`:root { --primary: #ffffff; } .x { color: #f6f6f8; }`);
    expect(colors).toHaveLength(0);
  });
});

describe('logo candidates', () => {
  const html = `
    <html><head>
      <meta property="og:image" content="/social-card.png">
      <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
      <link rel="icon" sizes="32x32" href="/favicon-32.png">
      <link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any">
    </head><body>
      <header><img src="/img/logo.svg" alt="Acme logo" class="site-logo"></header>
      <img src="/img/hero.jpg" alt="hero">
    </body></html>`;

  it('never returns og:image and ranks header logo img first', () => {
    const candidates = collectLogoCandidates(html, BASE, NO_JSONLD);
    expect(candidates.map((c) => c.url)).not.toContain('https://example.com/social-card.png');
    expect(candidates[0]).toEqual({ url: 'https://example.com/img/logo.svg', source: 'img-logo' });
  });

  it('prefers JSON-LD logo above everything', () => {
    const candidates = collectLogoCandidates(html, BASE, {
      name: '',
      description: '',
      logo: 'https://cdn.example.com/org-logo.png',
    });
    expect(candidates[0].source).toBe('json-ld');
  });

  it('falls back to apple-touch-icon before generic favicons', () => {
    const noImg = html.replace(/<header>[\s\S]*?<\/header>/, '');
    const candidates = collectLogoCandidates(noImg, BASE, NO_JSONLD);
    expect(candidates[0].url).toBe('https://example.com/apple-touch-icon.png');
  });
});

describe('extractJsonLdBrand', () => {
  it('reads Organization name/description/logo, including @graph', () => {
    const html = `<script type="application/ld+json">{
      "@context": "https://schema.org",
      "@graph": [{
        "@type": "Organization",
        "name": "Acme Inc",
        "description": "Acme builds rockets for coyotes.",
        "logo": { "@type": "ImageObject", "url": "https://example.com/logo.png" }
      }]
    }</script>`;
    expect(extractJsonLdBrand(html)).toEqual({
      name: 'Acme Inc',
      description: 'Acme builds rockets for coyotes.',
      logo: 'https://example.com/logo.png',
    });
  });

  it('survives malformed JSON', () => {
    const html = `<script type="application/ld+json">{not json}</script>`;
    expect(extractJsonLdBrand(html)).toEqual(NO_JSONLD);
  });
});

describe('name and description', () => {
  it('prefers og:site_name, then JSON-LD, then segmented og:title', () => {
    expect(pickName(`<meta property="og:site_name" content="Acme">`, NO_JSONLD)).toBe('Acme');
    expect(pickName('', { ...NO_JSONLD, name: 'Acme Inc' })).toBe('Acme Inc');
    expect(
      pickName(`<meta property="og:title" content="Acme — Ship faster">`, NO_JSONLD),
    ).toBe('Acme');
  });

  it('detects truncated meta descriptions', () => {
    expect(looksTruncated('Built for indie developers who')).toBe(true);
    expect(looksTruncated('A live revenue feed for App Store events…')).toBe(true);
    expect(looksTruncated('A complete sentence about the product.')).toBe(false);
  });

  it('falls back to body copy when every meta description is cut off', () => {
    const html = `
      <meta name="description" content="A live revenue feed for App Store and Stripe events. Built for indie developers who">
      <body><p>RevTrakkr turns your App Store and Stripe events into one live revenue feed, so indie developers always know what they earned today.</p></body>`;
    const description = pickDescription(html, NO_JSONLD);
    expect(description).toMatch(/^RevTrakkr turns/);
    expect(looksTruncated(description)).toBe(false);
  });

  it('trims a truncated description back to its last complete sentence', () => {
    expect(
      cleanDescription('A live revenue feed for App Store and Stripe events. Built for indie developers who'),
    ).toBe('A live revenue feed for App Store and Stripe events.');
  });

  it('skips boilerplate paragraphs when reading body copy', () => {
    const html = `<body>
      <p>We use cookies to improve your experience on our site and to show ads.</p>
      <p>Shipyard is the deployment platform that turns every pull request into a production-grade preview environment.</p>
    </body>`;
    expect(extractLeadParagraph(html)).toMatch(/^Shipyard/);
  });
});

describe('manifest and stylesheet discovery', () => {
  it('resolves the manifest href and same-origin stylesheets only', () => {
    const html = `
      <link rel="manifest" href="/site.webmanifest">
      <link rel="stylesheet" href="/styles/app.css">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">`;
    expect(findManifestHref(html, BASE)).toBe('https://example.com/site.webmanifest');
    expect(findStylesheetHrefs(html, BASE, 3)).toEqual(['https://example.com/styles/app.css']);
  });

  it('parses manifest name, theme color, and largest icon first', () => {
    const manifest = parseManifest(
      JSON.stringify({
        name: 'Acme',
        theme_color: '#2563eb',
        icons: [
          { src: '/icon-192.png', sizes: '192x192' },
          { src: '/icon-512.png', sizes: '512x512' },
        ],
      }),
      BASE,
    );
    expect(manifest.name).toBe('Acme');
    expect(manifest.themeColor).toBe('#2563EB');
    expect(manifest.icons[0].src).toBe('https://example.com/icon-512.png');
  });

  it('returns an empty manifest for invalid JSON', () => {
    expect(parseManifest('nope', BASE)).toEqual({ name: '', themeColor: null, icons: [] });
  });
});

describe('bot challenge detection', () => {
  const cloudflareChallenge = `<!DOCTYPE html><html><head><title>Just a moment...</title></head>
<body><div id="challenge-running">Performing security verification</div>
<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>`;

  it('recognizes a Cloudflare managed challenge by title and by body markers', () => {
    expect(isBotChallengePage(cloudflareChallenge)).toBe(true);
    expect(isBotChallengePage('<html><head><title>Acme</title></head><body><div class="cf-turnstile"></div></body></html>')).toBe(true);
  });

  it('leaves ordinary pages alone, even ones that mention security', () => {
    expect(isBotChallengePage('<html><head><title>Acme Security Cameras</title></head><body><p>Protect your home.</p></body></html>')).toBe(false);
  });

  it('flags model output that read a challenge page', () => {
    expect(looksLikeChallengeText('mustardseedimpactinternational.org Performing security verification')).toBe(true);
    expect(looksLikeChallengeText('Acme sells anvils to coyotes.')).toBe(false);
  });
});
