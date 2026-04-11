/**
 * Shared product knowledge enrichment logic.
 *
 * enrichProductKnowledgeFromUrl() fetches a product URL, extracts visible
 * text, and calls Gemini 2.5 Flash to produce a structured ProductKnowledge
 * object. Used by both the general-purpose /api/products/enrich route and
 * the per-product /api/products/[id]/enrich route.
 *
 * extractVisibleText() and findFeaturesPage() are exported for unit testing.
 */
import { assertSafeOutboundUrl, readResponseTextWithLimit } from '@/lib/network-security';
import type { ProductKnowledge } from '@/lib/schemas';

const MAX_HTML_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;

export async function safeFetch(rawUrl: string, timeoutMs: number): Promise<Response | null> {
  let currentUrl = rawUrl;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const safeUrl = await assertSafeOutboundUrl(currentUrl);
    const res = await fetch(safeUrl.toString(), {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Host': new URL(currentUrl).host,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      currentUrl = new URL(loc, currentUrl).toString();
      continue;
    }
    return res;
  }
  return null;
}

export function extractVisibleText(html: string, maxChars = 16000): string {
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    || html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  let clean = mainMatch ? mainMatch[1] : html;
  clean = clean
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const headings = [...clean.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').trim())
    .filter(Boolean)
    .join(' | ');

  const body = clean
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const combined = headings ? `HEADINGS: ${headings}\n\nCONTENT: ${body}` : body;
  return combined.slice(0, maxChars);
}

export function findFeaturesPage(html: string, baseUrl: string): string | null {
  const patterns = [
    /<a[^>]*href=["']([^"']*features[^"']*)["'][^>]*>/gi,
    /<a[^>]*href=["']([^"']+)["'][^>]*>\s*Features\s*<\/a>/gi,
  ];
  for (const p of patterns) {
    const m = p.exec(html);
    if (m?.[1]) {
      try {
        const u = new URL(m[1], baseUrl);
        if (u.origin === new URL(baseUrl).origin) return u.toString();
      } catch { /* skip */ }
    }
  }
  return null;
}

const VALID_PROOF_TYPES = ['stat', 'testimonial', 'award', 'press'] as const;
type ProofType = typeof VALID_PROOF_TYPES[number];

/**
 * Fetches a product URL, extracts content, and calls Gemini to produce
 * a structured ProductKnowledge object. Throws if GEMINI_API_KEY is missing.
 */
export async function enrichProductKnowledgeFromUrl(url: string): Promise<ProductKnowledge> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  let html = '';
  let finalUrl = url;
  try {
    const res = await safeFetch(url, 15_000);
    if (res?.ok) {
      finalUrl = res.url || url;
      html = await readResponseTextWithLimit(res, MAX_HTML_BYTES);
    }
  } catch { /* non-fatal — proceed with empty html */ }

  const pageText = extractVisibleText(html);

  let featuresText = '';
  const featuresUrl = findFeaturesPage(html, finalUrl);
  if (featuresUrl) {
    try {
      const fr = await safeFetch(featuresUrl, 8_000);
      if (fr?.ok) {
        const fh = await readResponseTextWithLimit(fr, MAX_HTML_BYTES);
        featuresText = extractVisibleText(fh, 6000);
      }
    } catch { /* non-fatal */ }
  }

  const prompt = `You are a product marketing analyst extracting structured knowledge from a product website. This knowledge will be used to generate TikTok slideshows, social media posts, and ad campaigns. Be specific and concrete — extract real information found on the page. Do NOT invent or hallucinate details.

URL: ${url}

Main page content:
${pageText}
${featuresText ? `\nFeatures page content:\n${featuresText}` : ''}

Return ONLY a valid JSON object (no markdown fences, no extra text) with exactly this structure:

{
  "features": [
    { "title": "Feature name", "description": "What it does", "benefit": "Why users care / the payoff" }
  ],
  "usps": ["3-6 unique selling propositions as short, punchy phrases the brand uses"],
  "painPoints": ["4-6 specific problems this product solves, in customer language"],
  "proofPoints": [
    { "type": "stat|testimonial|award|press", "content": "The proof point text", "source": "Where it comes from" }
  ],
  "targetAudienceDemographics": "Age range, job titles, company types, or other demographic descriptors",
  "targetAudiencePsychographics": "Values, goals, lifestyle, aspirations of the target user",
  "targetAudiencePainStatement": "The core frustration in the customer own words",
  "targetAudienceDesiredOutcome": "What the customer wants to achieve or feel",
  "competitors": ["Named competitors or alternatives explicitly or implicitly referenced"],
  "differentiators": ["What makes this different from alternatives"],
  "positioning": "1-2 sentence positioning statement capturing who it is for, what it does, and why it wins",
  "contentAngles": ["5 distinct story angles for TikTok slideshows about this product"]
}

Rules:
- features: 3-8 real product features with concrete benefits
- usps: extract from taglines, hero copy, value props on the page
- painPoints: derive from problem statements, before/after framing, customer pain language
- proofPoints: customer quotes, metrics (50% faster, 10k users), press mentions, awards
- contentAngles: creative, specific angles like "Before/after showing old workflow vs new one"
- If information is not found on the page, use empty arrays or empty strings — do not invent`;

  const geminiRes = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  const data = await geminiRes.json() as Record<string, unknown>;
  const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
  const raw = (candidates?.[0]?.content as Record<string, unknown> | undefined)
    ?.parts as Array<Record<string, unknown>> | undefined;
  const rawText = String(raw?.[0]?.text || '');
  const jsonText = rawText.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

  let aiResult: Record<string, unknown> | null = null;
  try { aiResult = JSON.parse(jsonText) as Record<string, unknown>; } catch { /* fall through */ }

  const ai = aiResult ?? {};

  return {
    features: (Array.isArray(ai.features) ? ai.features : []).slice(0, 20).map((f: unknown) => {
      const feat = f as Record<string, unknown>;
      return {
        title: String(feat?.title || '').slice(0, 200),
        description: String(feat?.description || '').slice(0, 500),
        benefit: String(feat?.benefit || '').slice(0, 500),
      };
    }),
    usps: (Array.isArray(ai.usps) ? ai.usps : []).slice(0, 10).map((s: unknown) => String(s).slice(0, 300)),
    painPoints: (Array.isArray(ai.painPoints) ? ai.painPoints : []).slice(0, 10).map((s: unknown) => String(s).slice(0, 300)),
    proofPoints: (Array.isArray(ai.proofPoints) ? ai.proofPoints : []).slice(0, 20).map((p: unknown) => {
      const pp = p as Record<string, unknown>;
      const rawType = String(pp?.type || 'stat');
      const type: ProofType = (VALID_PROOF_TYPES as readonly string[]).includes(rawType)
        ? (rawType as ProofType)
        : 'stat';
      return {
        type,
        content: String(pp?.content || '').slice(0, 1000),
        source: String(pp?.source || '').slice(0, 200),
      };
    }),
    targetAudienceDemographics: String(ai.targetAudienceDemographics || '').slice(0, 500),
    targetAudiencePsychographics: String(ai.targetAudiencePsychographics || '').slice(0, 500),
    targetAudiencePainStatement: String(ai.targetAudiencePainStatement || '').slice(0, 500),
    targetAudienceDesiredOutcome: String(ai.targetAudienceDesiredOutcome || '').slice(0, 500),
    competitors: (Array.isArray(ai.competitors) ? ai.competitors : []).slice(0, 10).map((s: unknown) => String(s).slice(0, 200)),
    differentiators: (Array.isArray(ai.differentiators) ? ai.differentiators : []).slice(0, 10).map((s: unknown) => String(s).slice(0, 300)),
    positioning: String(ai.positioning || '').slice(0, 1000),
    productImages: [],
    contentAngles: (Array.isArray(ai.contentAngles) ? ai.contentAngles : []).slice(0, 10).map((s: unknown) => String(s).slice(0, 300)),
    lastEnrichedAt: new Date().toISOString(),
    enrichmentSource: 'url_import',
  };
}
