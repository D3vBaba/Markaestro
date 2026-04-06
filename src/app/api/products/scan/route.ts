import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import {
  assertSafeOutboundUrl,
  readResponseBufferWithLimit,
  readResponseTextWithLimit,
} from '@/lib/network-security';
import sharp from 'sharp';
import { z } from 'zod';

const schema = z.object({
  url: z.string().url(),
});

const MAX_HTML_BYTES = 1_000_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 5;

type ScanResult = {
  name: string;
  description: string;
  category: 'saas' | 'mobile' | 'web' | 'api' | 'marketplace' | 'other';
  pricingTier: string;
  tags: string[];
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string;
  targetAudience: string;
  tone: string;
};

/** Follow redirects manually so we can validate each hop against SSRF rules. */
async function safeFetchWithRedirects(
  rawUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response | null> {
  let currentUrl = rawUrl;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const safeUrl = await assertSafeOutboundUrl(currentUrl);
    const res = await fetch(safeUrl.toString(), {
      redirect: 'manual',
      headers: { ...headers, Host: new URL(currentUrl).host },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return null;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return res;
  }
  return null; // too many redirects
}

// ─── HTML meta extraction ──────────────────────────────────────────────────────

type PageMeta = {
  title: string;
  description: string;
  themeColor: string;
  ogImage: string;
  logoUrl: string;
  cssColors: string[];
  jsonLd: Record<string, unknown>[];
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: string;
  manifestUrl: string;
};

/** Extract key metadata, CSS color hints, JSON-LD, and twitter cards from raw HTML. */
function extractMeta(html: string, baseUrl: string): PageMeta {
  const get = (pattern: RegExp) => {
    const m = html.match(pattern);
    return m ? (m[1] || '').trim() : '';
  };

  // Open Graph
  const ogTitle =
    get(/<meta\s+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["'][^>]*property=["']og:title["']/i);

  const ogDescription =
    get(/<meta\s+property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["'][^>]*property=["']og:description["']/i);

  const metaDescription =
    get(/<meta\s+name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["'][^>]*name=["']description["']/i);

  // Twitter Cards
  const twitterTitle =
    get(/<meta\s+(?:name|property)=["']twitter:title["'][^>]*content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["'][^>]*(?:name|property)=["']twitter:title["']/i);

  const twitterDescription =
    get(/<meta\s+(?:name|property)=["']twitter:description["'][^>]*content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["'][^>]*(?:name|property)=["']twitter:description["']/i);

  const rawTwitterImage =
    get(/<meta\s+(?:name|property)=["']twitter:image["'][^>]*content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["'][^>]*(?:name|property)=["']twitter:image["']/i);

  let twitterImage = rawTwitterImage;
  if (rawTwitterImage) {
    try { twitterImage = new URL(rawTwitterImage, baseUrl).toString(); } catch { /* keep raw */ }
  }

  const title = ogTitle || get(/<title[^>]*>([^<]+)<\/title>/i);
  const description = ogDescription || metaDescription;

  const themeColor =
    get(/<meta\s+name=["']theme-color["'][^>]*content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["'][^>]*name=["']theme-color["']/i);

  const rawOgImage =
    get(/<meta\s+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);

  let ogImage = rawOgImage;
  if (rawOgImage) {
    try { ogImage = new URL(rawOgImage, baseUrl).toString(); } catch { /* keep raw */ }
  }

  // Prefer apple-touch-icon (180x180) -> raster icon -> favicon.ico
  const iconMatches = [...html.matchAll(/<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi)];
  const hrefMatches = [...html.matchAll(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/gi)];
  const allIconHrefs = [
    ...iconMatches.map((m) => m[1]),
    ...hrefMatches.map((m) => m[1]),
  ].filter(Boolean);

  const rasterIcons = allIconHrefs.filter((h) => !/\.svg(\?|$)/i.test(h));
  const sizedIcons = rasterIcons.filter((h) => /\d{2,}x\d{2,}/i.test(h));
  const bestIcon = sizedIcons.sort((a, b) => {
    const sizeOf = (s: string) => {
      const m = s.match(/(\d+)x\d+/i);
      return m ? parseInt(m[1], 10) : 0;
    };
    return sizeOf(b) - sizeOf(a);
  })[0] || rasterIcons[0] || '/favicon.ico';

  let logoUrl = bestIcon;
  try { logoUrl = new URL(bestIcon, baseUrl).toString(); } catch { /* keep */ }

  // Extract hex colors from CSS custom properties in <style> blocks
  const cssColors: string[] = [];
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  for (const css of styleBlocks) {
    const colorVarMatches = css.matchAll(/--(primary|brand|accent|secondary|color)[^:]*:\s*(#[0-9a-f]{3,8})/gi);
    for (const m of colorVarMatches) {
      const hex = m[2];
      if (/^#[0-9a-f]{6}$/i.test(hex) && !cssColors.includes(hex.toLowerCase())) {
        cssColors.push(hex.toLowerCase());
      }
    }
  }

  // Extract JSON-LD structured data
  const jsonLd: Record<string, unknown>[] = [];
  const ldMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed['@graph'] && Array.isArray(parsed['@graph'])) {
        jsonLd.push(...parsed['@graph']);
      } else {
        jsonLd.push(parsed);
      }
    } catch { /* skip malformed */ }
  }

  // Look for web app manifest link
  const manifestUrl =
    get(/<link[^>]*rel=["']manifest["'][^>]*href=["']([^"']+)["']/i) ||
    get(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']manifest["']/i);

  return {
    title, description, themeColor, ogImage, logoUrl, cssColors,
    jsonLd, twitterTitle, twitterDescription, twitterImage, manifestUrl,
  };
}

/** Extract visible text from HTML, prioritising main content and headings. */
function extractVisibleText(html: string, maxChars = 14000): string {
  // Try to find the main content area first
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    || html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || html.match(/<div[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/div>/i);

  // Strip noise elements from the HTML before extracting text
  let cleanHtml = mainMatch ? mainMatch[1] : html;

  cleanHtml = cleanHtml
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<div[^>]*(?:cookie|consent|banner|popup|modal|overlay)[^>]*>[\s\S]*?<\/div>/gi, '');

  const headingMatches = [...cleanHtml.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)];
  const headings = headingMatches
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').trim())
    .filter(Boolean)
    .join(' | ');

  const body = cleanHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s{2,}/g, ' ')
    .trim();

  const combined = headings ? `HEADINGS: ${headings}\n\nPAGE TEXT: ${body}` : body;
  return combined.slice(0, maxChars);
}

/** Summarise JSON-LD structured data into a compact string for the LLM. */
function summariseJsonLd(items: Record<string, unknown>[]): string {
  if (!items.length) return '';

  const interesting = items.filter((item) => {
    const type = String(item['@type'] || '');
    return /product|software|organization|website|service|offer|brand/i.test(type);
  });

  if (!interesting.length) return '';

  const lines: string[] = [];
  for (const item of interesting.slice(0, 3)) {
    const parts: string[] = [`@type: ${item['@type']}`];
    if (item.name) parts.push(`name: ${item.name}`);
    if (item.description) parts.push(`description: ${String(item.description).slice(0, 300)}`);
    if (item.url) parts.push(`url: ${item.url}`);

    const offers = item.offers as Record<string, unknown> | undefined;
    if (offers) {
      if (offers.price) parts.push(`price: ${offers.priceCurrency || ''}${offers.price}`);
      if (offers.description) parts.push(`offer: ${offers.description}`);
    }

    if (item.logo) {
      const logo = typeof item.logo === 'string' ? item.logo : (item.logo as Record<string, unknown>)?.url;
      if (logo) parts.push(`logo: ${logo}`);
    }

    lines.push(parts.join(', '));
  }
  return lines.join('\n');
}

/** Find a pricing page URL from the HTML if present. */
function findPricingUrl(html: string, baseUrl: string): string | null {
  const patterns = [
    /<a[^>]*href=["']([^"']*pricing[^"']*)["'][^>]*>/gi,
    /<a[^>]*href=["']([^"']+)["'][^>]*>\s*(?:Pricing|Plans|Plans\s*(?:&|and)\s*Pricing)\s*<\/a>/gi,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      try {
        const url = new URL(match[1], baseUrl);
        if (url.origin === new URL(baseUrl).origin) return url.toString();
      } catch { /* skip */ }
    }
  }
  return null;
}

// ─── Color extraction ────────────────────────────────────────────────────────

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

async function extractColorsFromImage(
  imageUrl: string,
  fallbackColor: string,
): Promise<{ primary: string; secondary: string; accent: string } | null> {
  try {
    const safeUrl = await assertSafeOutboundUrl(imageUrl);
    const imgRes = await fetch(safeUrl.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Markaestro/1.0)' },
    });
    if (!imgRes.ok) return null;

    const contentType = imgRes.headers.get('content-type') || '';
    if (!contentType.startsWith('image/') || contentType.includes('svg') || contentType.includes('xml')) {
      return null;
    }

    const buffer = await readResponseBufferWithLimit(imgRes, MAX_IMAGE_BYTES);
    if (buffer.length < 200) return null;

    const stats = await sharp(buffer).removeAlpha().stats();
    const primary = stats.dominant
      ? rgbToHex(stats.dominant.r, stats.dominant.g, stats.dominant.b)
      : fallbackColor;
    const secondary = rgbToHex(
      stats.channels[0]?.mean ?? 0,
      stats.channels[1]?.mean ?? 0,
      stats.channels[2]?.mean ?? 0,
    );
    const accent = rgbToHex(
      (stats.dominant?.r ?? 0) * 0.6 + 255 * 0.4,
      (stats.dominant?.g ?? 0) * 0.6 + 255 * 0.4,
      (stats.dominant?.b ?? 0) * 0.6 + 255 * 0.4,
    );

    return { primary, secondary, accent };
  } catch {
    return null;
  }
}

/** Fetch manifest.json for theme_color and background_color. */
async function fetchManifestColors(
  manifestUrl: string,
  baseUrl: string,
): Promise<{ themeColor?: string; backgroundColor?: string }> {
  try {
    const fullUrl = new URL(manifestUrl, baseUrl).toString();
    const safeUrl = await assertSafeOutboundUrl(fullUrl);
    const res = await fetch(safeUrl.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(5_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Markaestro/1.0)' },
    });
    if (!res.ok) return {};
    const text = await readResponseTextWithLimit(res, 100_000);
    const manifest = JSON.parse(text);
    return {
      themeColor: typeof manifest.theme_color === 'string' ? manifest.theme_color : undefined,
      backgroundColor: typeof manifest.background_color === 'string' ? manifest.background_color : undefined,
    };
  } catch {
    return {};
  }
}

async function extractBrandColors(
  ogImage: string,
  logoUrl: string,
  themeColor: string,
  cssColors: string[],
  manifestUrl: string,
  baseUrl: string,
): Promise<{ primary: string; secondary: string; accent: string }> {
  const fallback = { primary: themeColor || '#6366f1', secondary: '', accent: '' };

  // 0. Fetch manifest.json colors in background
  let manifestColors: { themeColor?: string; backgroundColor?: string } = {};
  if (manifestUrl) {
    manifestColors = await fetchManifestColors(manifestUrl, baseUrl);
  }

  const allCssColors = [...cssColors];
  if (manifestColors.themeColor && /^#[0-9a-f]{6}$/i.test(manifestColors.themeColor)) {
    const hex = manifestColors.themeColor.toLowerCase();
    if (!allCssColors.includes(hex)) allCssColors.push(hex);
  }

  // 1. CSS variables — highest accuracy
  if (allCssColors.length >= 2) {
    return {
      primary: allCssColors[0],
      secondary: allCssColors[1] || '',
      accent: allCssColors[2] || '',
    };
  }

  // 2. og:image — large image, best vibrant results
  if (ogImage) {
    const result = await extractColorsFromImage(ogImage, themeColor || '#6366f1');
    if (result && result.primary !== (themeColor || '#6366f1')) {
      if (allCssColors.length === 1) result.primary = allCssColors[0];
      return result;
    }
  }

  // 3. Logo / favicon
  const logoResult = await extractColorsFromImage(logoUrl, themeColor || '#6366f1');
  if (logoResult) {
    if (allCssColors.length === 1) logoResult.primary = allCssColors[0];
    return logoResult;
  }

  // 4. CSS single color + themeColor
  if (allCssColors.length === 1) {
    return { primary: allCssColors[0], secondary: themeColor || '', accent: '' };
  }

  return fallback;
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'products.write');
    const body = await req.json();
    const { url } = schema.parse(body);

    // Fetch the homepage — follow redirects safely
    let html = '';
    let finalUrl = url;
    try {
      const pageRes = await safeFetchWithRedirects(
        url,
        {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        12_000,
      );
      if (pageRes?.ok) {
        finalUrl = pageRes.url || url;
        html = await readResponseTextWithLimit(pageRes, MAX_HTML_BYTES);
      }
    } catch { /* Non-fatal */ }

    const meta = extractMeta(html, finalUrl);
    const visibleText = extractVisibleText(html);
    const jsonLdSummary = summariseJsonLd(meta.jsonLd);

    // Try to fetch pricing page for extra context
    let pricingText = '';
    const pricingUrl = findPricingUrl(html, finalUrl);
    const pricingPromise = pricingUrl
      ? (async () => {
          try {
            const res = await safeFetchWithRedirects(
              pricingUrl,
              {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
              },
              8_000,
            );
            if (res?.ok) {
              const pricingHtml = await readResponseTextWithLimit(res, MAX_HTML_BYTES);
              pricingText = extractVisibleText(pricingHtml, 4000);
            }
          } catch { /* non-fatal */ }
        })()
      : Promise.resolve();

    // Check for a better logo from JSON-LD
    let jsonLdLogo = '';
    for (const item of meta.jsonLd) {
      if (item.logo) {
        const logo = typeof item.logo === 'string'
          ? item.logo
          : (item.logo as Record<string, unknown>)?.url;
        if (typeof logo === 'string') {
          try { jsonLdLogo = new URL(logo as string, finalUrl).toString(); } catch { /* skip */ }
          break;
        }
      }
    }

    // Run color extraction, pricing fetch, and Gemini in parallel
    const [colors, , geminiResult] = await Promise.all([
      extractBrandColors(
        meta.ogImage, jsonLdLogo || meta.logoUrl, meta.themeColor,
        meta.cssColors, meta.manifestUrl, finalUrl,
      ),
      pricingPromise,
      (async () => {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return null;

        // Wait for pricing to resolve before building prompt
        await pricingPromise;

        const structuredDataSection = jsonLdSummary
          ? `\nStructured data (JSON-LD) from the page:\n${jsonLdSummary}\n`
          : '';

        const twitterSection = (meta.twitterTitle || meta.twitterDescription)
          ? `\nTwitter card: ${meta.twitterTitle || ''} — ${meta.twitterDescription || ''}`
          : '';

        const pricingSection = pricingText
          ? `\nPricing page content:\n${pricingText}\n`
          : '';

        const cssColorHint = meta.cssColors.length
          ? `\nCSS brand color variables found: ${meta.cssColors.join(', ')}`
          : '';

        const prompt = `You are a product analyst extracting structured data from a SaaS/app website to prefill a marketing tool registration form. Be specific and accurate — do NOT hallucinate details not found on the page.

URL: ${url}
Page title: ${meta.title || '(none)'}
Meta description: ${meta.description || '(none)'}
Theme color: ${meta.themeColor || '(none)'}${twitterSection}${structuredDataSection}${cssColorHint}

Page content (headings first, then body text):
${visibleText}${pricingSection}

Return ONLY a valid JSON object with NO markdown fences or extra text:
{
  "name": "The product's proper name (short, title-case, e.g. 'Notion', 'Linear', 'Cal.com')",
  "description": "2 sentences max. First sentence: what the product does. Second sentence: the main benefit or who it's for. Be concrete and specific.",
  "category": "One of exactly: saas | mobile | web | api | marketplace | other. 'saas' = subscription software with accounts/dashboards. 'mobile' = primarily a native app. 'api' = developer API/SDK product. 'marketplace' = two-sided marketplace. 'web' = web tool without accounts.",
  "pricingTier": "Pricing summary from the page. Examples: 'Free', 'Free trial, Pro $19/mo', 'Starts at $49/mo', 'Free open source, Cloud $20/mo', 'Contact for pricing'. If pricing is not clear from the data, write 'Check pricing page'.",
  "tags": ["5 specific lowercase tags. Mix: 1 category tag (e.g. 'project-management', 'email-marketing', 'analytics'), 1 tech/approach tag (e.g. 'ai-powered', 'no-code', 'open-source'), 1 audience tag (e.g. 'startups', 'developers', 'enterprise'), 2 feature/use-case tags (e.g. 'automation', 'collaboration', 'real-time'). Use hyphens for multi-word tags."],
  "targetAudience": "Specific audience description. Examples: 'B2B SaaS founders and product teams', 'Freelance developers and agencies', 'E-commerce store owners on Shopify'. Be specific — not just 'businesses'.",
  "tone": "2-3 words describing the brand voice from the writing style on the page. Examples: 'bold, direct', 'friendly, approachable', 'professional, technical', 'playful, energetic'"
}`;

        const res = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
            }),
            signal: AbortSignal.timeout(25_000),
          },
        );
        const data = await res.json();
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonText = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
        try { return JSON.parse(jsonText); } catch { return null; }
      })(),
    ]);

    const ai = geminiResult ?? {};
    const categories = ['saas', 'mobile', 'web', 'api', 'marketplace', 'other'] as const;

    const safe: ScanResult = {
      name: String(ai.name || meta.title || meta.twitterTitle || new URL(url).hostname.replace('www.', '')).slice(0, 100),
      description: String(ai.description || meta.description || meta.twitterDescription || '').slice(0, 500),
      category: categories.includes(ai.category) ? ai.category : 'saas',
      pricingTier: String(ai.pricingTier || '').slice(0, 100),
      tags: (Array.isArray(ai.tags) ? ai.tags : []).slice(0, 5).map((t: unknown) => String(t).slice(0, 40)),
      primaryColor: colors.primary,
      secondaryColor: colors.secondary,
      accentColor: colors.accent,
      logoUrl: jsonLdLogo || meta.logoUrl,
      targetAudience: String(ai.targetAudience || '').slice(0, 200),
      tone: String(ai.tone || '').slice(0, 60),
    };

    return apiOk(safe);
  } catch (error) {
    return apiError(error);
  }
}
