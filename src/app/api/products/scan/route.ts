import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const schema = z.object({
  url: z.string().url(),
});

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

/** Extract key metadata from raw HTML without a DOM parser. */
function extractMeta(html: string, baseUrl: string): {
  title: string;
  description: string;
  themeColor: string;
  ogImage: string;
  logoUrl: string;
} {
  const get = (pattern: RegExp) => {
    const m = html.match(pattern);
    return m ? (m[1] || '').trim() : '';
  };

  const title =
    get(/<meta\s+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["'][^>]*property=["']og:title["']/i) ||
    get(/<title[^>]*>([^<]+)<\/title>/i);

  const description =
    get(/<meta\s+property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["'][^>]*property=["']og:description["']/i) ||
    get(/<meta\s+name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["'][^>]*name=["']description["']/i);

  const themeColor =
    get(/<meta\s+name=["']theme-color["'][^>]*content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["'][^>]*name=["']theme-color["']/i);

  const ogImage =
    get(/<meta\s+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);

  // Prefer apple-touch-icon (180×180) → icon with sizes → icon → shortcut icon
  const appleTouchIcon =
    get(/<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i) ||
    get(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']apple-touch-icon["']/i);

  // Collect all <link rel="icon"> entries and pick the largest raster one
  const iconMatches = [...html.matchAll(/<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi)];
  const hrefMatches = [...html.matchAll(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/gi)];
  const allIconHrefs = [
    ...iconMatches.map((m) => m[1]),
    ...hrefMatches.map((m) => m[1]),
  ].filter(Boolean);

  // Skip SVG icons (vibrant can't read them); prefer PNG/ICO
  const rasterIcons = allIconHrefs.filter((h) => !/\.svg(\?|$)/i.test(h));

  const rawLogoUrl = appleTouchIcon || rasterIcons[0] || '/favicon.ico';

  // Resolve relative URLs
  let logoUrl = rawLogoUrl;
  try {
    logoUrl = new URL(rawLogoUrl, baseUrl).toString();
  } catch { /* keep rawLogoUrl */ }

  return { title, description, themeColor, ogImage, logoUrl };
}

/** Truncate HTML to ~8 KB of visible text for the AI prompt. */
function extractVisibleText(html: string, maxChars = 8000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/** Convert an RGB array to a hex string. */
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/**
 * Fetch a logo image and extract dominant brand colors using node-vibrant.
 * Returns up to three hex colors: primary, secondary, accent.
 */
async function extractColorsFromLogo(
  logoUrl: string,
  themeColor: string,
): Promise<{ primary: string; secondary: string; accent: string }> {
  const fallback = { primary: themeColor || '#6366f1', secondary: '', accent: '' };

  try {
    const imgRes = await fetch(logoUrl, {
      signal: AbortSignal.timeout(8_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Markaestro/1.0)' },
    });
    if (!imgRes.ok) return fallback;

    const contentType = imgRes.headers.get('content-type') || '';
    // Skip SVG — vibrant needs raster pixels
    if (contentType.includes('svg')) return fallback;

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    if (buffer.length < 100) return fallback;

    // Dynamic import to avoid bundling issues in Next.js edge/server
    const Vibrant = (await import('node-vibrant')).default;
    const palette = await Vibrant.from(buffer).getPalette();

    const primary =
      palette.Vibrant?.rgb ? rgbToHex(...(palette.Vibrant.rgb as [number, number, number])) :
      palette.DarkVibrant?.rgb ? rgbToHex(...(palette.DarkVibrant.rgb as [number, number, number])) :
      themeColor || '#6366f1';

    const secondary =
      palette.DarkVibrant?.rgb ? rgbToHex(...(palette.DarkVibrant.rgb as [number, number, number])) :
      palette.LightVibrant?.rgb ? rgbToHex(...(palette.LightVibrant.rgb as [number, number, number])) :
      '';

    const accent =
      palette.Muted?.rgb ? rgbToHex(...(palette.Muted.rgb as [number, number, number])) :
      palette.LightMuted?.rgb ? rgbToHex(...(palette.LightMuted.rgb as [number, number, number])) :
      '';

    return { primary, secondary, accent };
  } catch {
    return fallback;
  }
}

export async function POST(req: Request) {
  try {
    await requireContext(req);
    const body = await req.json();
    const { url } = schema.parse(body);

    // Fetch the page
    let html = '';
    try {
      const pageRes = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Markaestro/1.0; +https://markaestro.app)',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (pageRes.ok) html = await pageRes.text();
    } catch { /* Non-fatal */ }

    const { title, description, themeColor, logoUrl } = extractMeta(html, url);
    const visibleText = extractVisibleText(html);

    // Run color extraction and Gemini in parallel
    const [colors, geminiResult] = await Promise.all([
      extractColorsFromLogo(logoUrl, themeColor),
      (async () => {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return null;

        const prompt = `You are analysing a product website to prefill a product registration form.

URL: ${url}
Page title: ${title || '(none)'}
Meta description: ${description || '(none)'}

Page text (first 8000 chars):
${visibleText}

Return ONLY a valid JSON object (no markdown, no backticks) with these exact keys:
{
  "name": "product name (short, title-case)",
  "description": "1-2 sentence product description suitable for a marketing tool",
  "category": one of: "saas" | "mobile" | "web" | "api" | "marketplace" | "other",
  "pricingTier": "pricing summary e.g. 'Free, Pro $29/mo, Enterprise' or 'Free' or 'Paid' — keep it short",
  "tags": ["up to 5 lowercase tags relevant to this product"],
  "targetAudience": "brief target audience description e.g. 'SaaS founders, indie hackers'",
  "tone": "one or two words describing the brand tone e.g. 'professional, friendly'"
}`;

        const res = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
            }),
            signal: AbortSignal.timeout(20_000),
          },
        );
        const data = await res.json();
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonText = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();
        try { return JSON.parse(jsonText); } catch { return null; }
      })(),
    ]);

    const ai = geminiResult ?? {};
    const categories = ['saas', 'mobile', 'web', 'api', 'marketplace', 'other'] as const;

    const safe: ScanResult = {
      name: String(ai.name || title || new URL(url).hostname.replace('www.', '')).slice(0, 100),
      description: String(ai.description || description || '').slice(0, 500),
      category: categories.includes(ai.category) ? ai.category : 'saas',
      pricingTier: String(ai.pricingTier || '').slice(0, 100),
      tags: (Array.isArray(ai.tags) ? ai.tags : []).slice(0, 5).map((t: unknown) => String(t).slice(0, 30)),
      primaryColor: colors.primary,
      secondaryColor: colors.secondary,
      accentColor: colors.accent,
      logoUrl,
      targetAudience: String(ai.targetAudience || '').slice(0, 200),
      tone: String(ai.tone || '').slice(0, 60),
    };

    return apiOk(safe);
  } catch (error) {
    return apiError(error);
  }
}
