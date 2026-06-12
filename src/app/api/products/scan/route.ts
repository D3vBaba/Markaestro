import { z } from 'zod';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { assertSafeOutboundUrl, readResponseTextWithLimit } from '@/lib/network-security';

export const runtime = 'nodejs';

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_TAGS = 6;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const scanRequestSchema = z.object({
  url: z.string().trim().min(1, 'URL is required').max(2048),
});

const STOP_WORDS = new Set([
  'about', 'after', 'all', 'also', 'and', 'any', 'are', 'because', 'been', 'before',
  'best', 'both', 'but', 'can', 'could', 'does', 'each', 'every', 'for', 'from',
  'get', 'has', 'have', 'her', 'here', 'his', 'how', 'into', 'its', 'just', 'like',
  'make', 'more', 'most', 'new', 'not', 'now', 'one', 'only', 'other', 'our', 'out',
  'over', 'should', 'site', 'some', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'use', 'using', 'very', 'was', 'website', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'will', 'with', 'would', 'you',
  'your',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      const cp = Number.parseInt(hex, 16);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
    })
    .replace(/&#(\d+);/g, (match, dec) => {
      const cp = Number(dec);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:#39|apos);/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function getMetaContent(html: string, key: string): string {
  const keyPattern = new RegExp(
    `(?:name|property)\\s*=\\s*["']${escapeRegExp(key)}["']`,
    'i',
  );
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    if (!keyPattern.test(tag)) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) return decodeHtmlEntities(content).trim();
  }
  return '';
}

function getTitle(html: string): string {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  return decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim();
}

function resolveUrl(href: string, base: URL): string {
  try {
    const resolved = new URL(href, base);
    return ['http:', 'https:'].includes(resolved.protocol) ? resolved.toString() : '';
  } catch {
    return '';
  }
}

function extractLogoUrl(html: string, baseUrl: URL): string {
  const ogImage = getMetaContent(html, 'og:image');
  if (ogImage) return resolveUrl(ogImage, baseUrl);

  let appleTouchIcon = '';
  let bestFavicon = '';
  let bestFaviconSize = -1;

  for (const tag of html.match(/<link\s[^>]*>/gi) ?? []) {
    const rel = (tag.match(/rel\s*=\s*["']([^"']*)["']/i)?.[1] ?? '').toLowerCase();
    const href = tag.match(/href\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    if (!rel || !href) continue;

    if (rel.includes('apple-touch-icon')) {
      if (!appleTouchIcon) appleTouchIcon = href;
    } else if (rel.split(/\s+/).includes('icon')) {
      const size = Number(tag.match(/sizes\s*=\s*["'](\d+)x\d+["']/i)?.[1] ?? 0);
      if (size > bestFaviconSize) {
        bestFaviconSize = size;
        bestFavicon = href;
      }
    }
  }

  const chosen = appleTouchIcon || bestFavicon;
  return chosen ? resolveUrl(chosen, baseUrl) : '';
}

function extractName(html: string): string {
  const siteName = getMetaContent(html, 'og:site_name');
  if (siteName) return siteName;

  const ogTitle = getMetaContent(html, 'og:title');
  if (ogTitle) return ogTitle;

  // <title> often appends taglines ("Acme — Ship faster"); keep the first segment.
  const title = getTitle(html);
  return title.split(/\s*[|•·–—]\s*/)[0]?.trim() ?? '';
}

function extractTags(html: string, title: string, description: string): string[] {
  const keywords = getMetaContent(html, 'keywords')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (keywords.length > 0) return keywords.slice(0, MAX_TAGS);

  // Fall back to prominent words from the title/description — generic only,
  // no category guessing.
  const words = `${title} ${description}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  return Array.from(new Set(words)).slice(0, 5);
}

async function fetchHtml(rawUrl: string): Promise<{ html: string; finalUrl: URL }> {
  let target = await assertSafeOutboundUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(target.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location || hop === MAX_REDIRECTS) {
        throw new Error('VALIDATION_SCAN_FETCH_FAILED');
      }
      // Re-validate every redirect hop so a public host can't bounce us to a
      // private address.
      target = await assertSafeOutboundUrl(new URL(location, target).toString());
      continue;
    }

    if (!res.ok) {
      throw new Error('VALIDATION_SCAN_FETCH_FAILED');
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      throw new Error('VALIDATION_SCAN_UNSUPPORTED_CONTENT');
    }

    const html = await readResponseTextWithLimit(res, MAX_HTML_BYTES);
    return { html, finalUrl: target };
  }

  throw new Error('VALIDATION_SCAN_FETCH_FAILED');
}

export async function POST(req: Request) {
  try {
    await requireContext(req);
    const body = await req.json();
    const { url } = scanRequestSchema.parse(body);

    let html: string;
    let finalUrl: URL;
    try {
      ({ html, finalUrl } = await fetchHtml(url));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // Network errors / timeouts / size limits all surface as a 4xx so the
      // client hook falls back to manual entry instead of treating it as a crash.
      throw new Error(msg.startsWith('VALIDATION_') ? msg : 'VALIDATION_SCAN_FETCH_FAILED');
    }

    const name = extractName(html);
    const description =
      getMetaContent(html, 'description') ||
      getMetaContent(html, 'og:description') ||
      getMetaContent(html, 'twitter:description');
    const title = getTitle(html);

    return apiOk({
      name,
      description,
      category: '',
      pricingTier: '',
      tags: extractTags(html, title, description),
      primaryColor: getMetaContent(html, 'theme-color'),
      secondaryColor: '',
      accentColor: '',
      logoUrl: extractLogoUrl(html, finalUrl),
      targetAudience: '',
      tone: '',
    });
  } catch (error) {
    return apiError(error);
  }
}
