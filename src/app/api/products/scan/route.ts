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
  targetAudience: string;
  tone: string;
};

/** Extract key metadata from raw HTML without a DOM parser. */
function extractMeta(html: string): {
  title: string;
  description: string;
  themeColor: string;
  ogImage: string;
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

  return { title, description, themeColor, ogImage };
}

/** Truncate HTML to ~8 KB of visible text for the AI prompt. */
function extractVisibleText(html: string, maxChars = 8000): string {
  // Remove script/style blocks
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return text.slice(0, maxChars);
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
      if (pageRes.ok) {
        html = await pageRes.text();
      }
    } catch {
      // Non-fatal — continue with empty HTML and just use the URL
    }

    const { title, description, themeColor } = extractMeta(html);
    const visibleText = extractVisibleText(html);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // Fallback: return basic info from meta tags without AI
      return apiOk({
        name: title || new URL(url).hostname.replace('www.', ''),
        description: description || '',
        category: 'saas' as const,
        pricingTier: '',
        tags: [],
        primaryColor: themeColor || '#6366f1',
        secondaryColor: '',
        targetAudience: '',
        tone: '',
      });
    }

    const prompt = `You are analysing a product website to prefill a product registration form.

URL: ${url}
Page title: ${title || '(none)'}
Meta description: ${description || '(none)'}
Theme color: ${themeColor || '(none)'}

Page text (first 8000 chars):
${visibleText}

Return ONLY a valid JSON object (no markdown, no backticks) with these exact keys:
{
  "name": "product name (short, title-case)",
  "description": "1-2 sentence product description suitable for a marketing tool",
  "category": one of: "saas" | "mobile" | "web" | "api" | "marketplace" | "other",
  "pricingTier": "pricing summary e.g. 'Free, Pro $29/mo, Enterprise' or 'Free' or 'Paid' — keep it short",
  "tags": ["up to 5 lowercase tags relevant to this product"],
  "primaryColor": "the brand's primary hex color (from theme-color, logo, buttons, or dominant UI color) — best guess",
  "secondaryColor": "a complementary hex color — best guess or empty string",
  "targetAudience": "brief target audience description e.g. 'SaaS founders, indie hackers'",
  "tone": "one or two words describing the brand tone e.g. 'professional, friendly'"
}`;

    const geminiRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 512,
          },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );

    const geminiData = await geminiRes.json();
    const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Strip any accidental markdown fences
    const jsonText = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();

    let result: ScanResult;
    try {
      result = JSON.parse(jsonText) as ScanResult;
    } catch {
      // Fallback to meta tags if Gemini returns unparseable output
      result = {
        name: title || new URL(url).hostname.replace('www.', ''),
        description: description || '',
        category: 'saas',
        pricingTier: '',
        tags: [],
        primaryColor: themeColor || '#6366f1',
        secondaryColor: '',
        targetAudience: '',
        tone: '',
      };
    }

    // Sanitize
    const safe: ScanResult = {
      name: String(result.name || title || '').slice(0, 100),
      description: String(result.description || description || '').slice(0, 500),
      category: (['saas', 'mobile', 'web', 'api', 'marketplace', 'other'] as const).includes(result.category)
        ? result.category
        : 'saas',
      pricingTier: String(result.pricingTier || '').slice(0, 100),
      tags: (Array.isArray(result.tags) ? result.tags : []).slice(0, 5).map((t) => String(t).slice(0, 30)),
      primaryColor: /^#[0-9a-f]{3,6}$/i.test(result.primaryColor || '')
        ? result.primaryColor
        : (themeColor || '#6366f1'),
      secondaryColor: /^#[0-9a-f]{3,6}$/i.test(result.secondaryColor || '') ? result.secondaryColor : '',
      targetAudience: String(result.targetAudience || '').slice(0, 200),
      tone: String(result.tone || '').slice(0, 60),
    };

    return apiOk(safe);
  } catch (error) {
    return apiError(error);
  }
}
