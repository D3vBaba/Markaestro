import { requireContext } from '@/lib/server-auth';
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

/** Extract key metadata and CSS color hints from raw HTML. */
function extractMeta(html: string, baseUrl: string): {
  title: string;
  description: string;
  themeColor: string;
  ogImage: string;
  logoUrl: string;
  cssColors: string[];
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

  const rawOgImage =
    get(/<meta\s+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);

  let ogImage = rawOgImage;
  if (rawOgImage) {
    try { ogImage = new URL(rawOgImage, baseUrl).toString(); } catch { /* keep raw */ }
  }

  // Prefer apple-touch-icon (180×180) → raster icon → favicon.ico
  const iconMatches = [...html.matchAll(/<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi)];
  const hrefMatches = [...html.matchAll(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/gi)];
  const allIconHrefs = [
    ...iconMatches.map((m) => m[1]),
    ...hrefMatches.map((m) => m[1]),
  ].filter(Boolean);

  // Pick largest raster icon by looking for size hints (e.g. 192x192 > 32x32)
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
  // Looks for --primary, --brand, --color-primary etc.
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

  return { title, description, themeColor, ogImage, logoUrl, cssColors };
}

/** Extract visible text from HTML, prioritising headings and nav for signal density. */
function extractVisibleText(html: string, maxChars = 12000): string {
  // Extract headings first for high-signal content
  const headingMatches = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)];
  const headings = headingMatches
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').trim())
    .filter(Boolean)
    .join(' | ');

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const combined = headings ? `HEADINGS: ${headings}\n\nPAGE TEXT: ${body}` : body;
  return combined.slice(0, maxChars);
}

/** Convert an RGB array to a hex string. */
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/**
 * Extract dominant brand colors from an image URL using sharp statistics.
 * Prefers og:image (large) over logo (often tiny favicon).
 */
async function extractColorsFromImage(
  imageUrl: string,
  fallbackColor: string,
): Promise<{ primary: string; secondary: string; accent: string } | null> {
  try {
    const safeUrl = await assertSafeOutboundUrl(imageUrl);
    const imgRes = await fetch(safeUrl.toString(), {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Markaestro/1.0)' },
    });
    if (!imgRes.ok) return null;

    const contentType = imgRes.headers.get('content-type') || '';
    if (!contentType.startsWith('image/') || contentType.includes('svg') || contentType.includes('xml')) {
      return null;
    }

    const buffer = await readResponseBufferWithLimit(imgRes, MAX_IMAGE_BYTES);
    // Minimum viable image size — 200 bytes rules out empty/error responses
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

/**
 * Best-effort brand color extraction.
 * Strategy (in priority order):
 *   1. CSS custom properties parsed from <style> blocks (exact brand colors)
 *   2. og:image with vibrant (large image = better palette)
 *   3. Logo/favicon with vibrant
 *   4. theme-color meta tag
 *   5. Default indigo
 */
async function extractBrandColors(
  ogImage: string,
  logoUrl: string,
  themeColor: string,
  cssColors: string[],
): Promise<{ primary: string; secondary: string; accent: string }> {
  const fallback = { primary: themeColor || '#6366f1', secondary: '', accent: '' };

  // 1. CSS variables — highest accuracy
  if (cssColors.length >= 2) {
    return {
      primary: cssColors[0],
      secondary: cssColors[1] || '',
      accent: cssColors[2] || '',
    };
  }

  // 2. og:image — large image, best vibrant results
  if (ogImage) {
    const result = await extractColorsFromImage(ogImage, themeColor || '#6366f1');
    if (result && result.primary !== (themeColor || '#6366f1')) {
      // Blend with CSS hint if we have one
      if (cssColors.length === 1) result.primary = cssColors[0];
      return result;
    }
  }

  // 3. Logo / favicon
  const logoResult = await extractColorsFromImage(logoUrl, themeColor || '#6366f1');
  if (logoResult) {
    if (cssColors.length === 1) logoResult.primary = cssColors[0];
    return logoResult;
  }

  // 4. CSS single color + themeColor
  if (cssColors.length === 1) {
    return { primary: cssColors[0], secondary: themeColor || '', accent: '' };
  }

  return fallback;
}

export async function POST(req: Request) {
  try {
    await requireContext(req);
    const body = await req.json();
    const { url } = schema.parse(body);
    const safeUrl = await assertSafeOutboundUrl(url);

    // Fetch the homepage
    let html = '';
    try {
      const pageRes = await fetch(safeUrl.toString(), {
        redirect: 'error',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (pageRes.ok) {
        html = await readResponseTextWithLimit(pageRes, MAX_HTML_BYTES);
      }
    } catch { /* Non-fatal */ }

    const { title, description, themeColor, ogImage, logoUrl, cssColors } = extractMeta(
      html,
      safeUrl.toString(),
    );
    const visibleText = extractVisibleText(html);

    // Run color extraction and Gemini in parallel
    const [colors, geminiResult] = await Promise.all([
      extractBrandColors(ogImage, logoUrl, themeColor, cssColors),
      (async () => {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return null;

        const prompt = `You are a product analyst extracting structured data from a SaaS/app website to prefill a marketing tool registration form. Be specific and accurate — do NOT hallucinate details not found on the page.

URL: ${url}
Page title: ${title || '(none)'}
Meta description: ${description || '(none)'}
Theme color: ${themeColor || '(none)'}

Page content (headings first, then body text):
${visibleText}

Return ONLY a valid JSON object with NO markdown fences or extra text:
{
  "name": "The product's proper name (short, title-case, e.g. 'Notion', 'Linear', 'Cal.com')",
  "description": "2 sentences max. First sentence: what the product does. Second sentence: the main benefit or who it's for. Be concrete and specific.",
  "category": "One of exactly: saas | mobile | web | api | marketplace | other. 'saas' = subscription software with accounts/dashboards. 'mobile' = primarily a native app. 'api' = developer API/SDK product. 'marketplace' = two-sided marketplace. 'web' = web tool without accounts.",
  "pricingTier": "Pricing summary from the page. Examples: 'Free', 'Free trial, Pro $19/mo', 'Starts at $49/mo', 'Free open source, Cloud $20/mo', 'Contact for pricing'. If pricing page not loaded, write 'Check pricing page'.",
  "tags": ["5 specific lowercase tags. Mix: 1 category tag (e.g. 'project-management', 'email-marketing', 'analytics'), 1 tech/approach tag (e.g. 'ai-powered', 'no-code', 'open-source'), 1 audience tag (e.g. 'startups', 'developers', 'enterprise'), 2 feature/use-case tags (e.g. 'automation', 'collaboration', 'real-time'). Use hyphens for multi-word tags."],
  "targetAudience": "Specific audience description. Examples: 'B2B SaaS founders and product teams', 'Freelance developers and agencies', 'E-commerce store owners on Shopify'. Be specific — not just 'businesses'.",
  "tone": "2-3 words describing the brand voice from the writing style on the page. Examples: 'bold, direct', 'friendly, approachable', 'professional, technical', 'playful, energetic'"
}`;

        const res = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
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
        // Strip any accidental markdown fences
        const jsonText = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
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
      tags: (Array.isArray(ai.tags) ? ai.tags : []).slice(0, 5).map((t: unknown) => String(t).slice(0, 40)),
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
