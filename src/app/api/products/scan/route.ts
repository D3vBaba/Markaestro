import { z } from 'zod';
import sharp from 'sharp';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import {
  assertSafeOutboundUrl,
  readResponseBufferWithLimit,
  readResponseTextWithLimit,
} from '@/lib/network-security';
import {
  collectLogoCandidates,
  extractCssColors,
  extractInlineStyles,
  extractJsonLdBrand,
  findManifestHref,
  findStylesheetHrefs,
  getMetaContent,
  getTitle,
  isNeutral,
  normalizeColor,
  parseManifest,
  pickDescription,
  pickName,
  pickPalette,
  rgbToHex,
  type WeightedColor,
} from '@/lib/products/scan-extract';

export const runtime = 'nodejs';

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_CSS_BYTES = 300 * 1024;
const MAX_MANIFEST_BYTES = 100 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const ASSET_TIMEOUT_MS = 4_000;
const MAX_REDIRECTS = 3;
const MAX_STYLESHEETS = 3;
const MAX_LOGO_ATTEMPTS = 4;
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

function extractTags(html: string, title: string, description: string): string[] {
  const keywords = getMetaContent(html, 'keywords')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (keywords.length > 0) return keywords.slice(0, MAX_TAGS);

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

/** Best-effort asset fetch: every failure returns null — enrichment must
    never sink the scan itself. */
async function fetchAsset(
  url: string,
  maxBytes: number,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const target = await assertSafeOutboundUrl(url);
    const res = await fetch(target.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return null;
    const buffer = await readResponseBufferWithLimit(res, maxBytes);
    return { buffer, contentType: res.headers.get('content-type') || '' };
  } catch {
    return null;
  }
}

type ValidatedLogo = { url: string; raster: Buffer | null };

/** Downloads candidates in ranked order and keeps the first real image:
    SVG accepted as-is; rasters must decode and be at least icon-sized with
    a plausible logo aspect ratio. */
async function validateLogo(candidates: { url: string }[]): Promise<ValidatedLogo | null> {
  for (const candidate of candidates.slice(0, MAX_LOGO_ATTEMPTS)) {
    const asset = await fetchAsset(candidate.url, MAX_IMAGE_BYTES);
    if (!asset) continue;

    const isSvg =
      asset.contentType.includes('svg') || /\.svg(\?|$)/i.test(candidate.url);
    if (isSvg) {
      // Guard against HTML error pages served at .svg URLs.
      const head = asset.buffer.subarray(0, 4096).toString('utf8');
      if (/<svg[\s>]/i.test(head)) return { url: candidate.url, raster: null };
      continue;
    }

    if (!asset.contentType.startsWith('image/') && asset.contentType !== '') continue;
    // Same guard for rasters: a body starting with "<" is an HTML page.
    if (asset.buffer[0] === 0x3c) continue;
    try {
      const meta = await sharp(asset.buffer).metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      if (w < 32 || h < 32) continue;
      const aspect = w / h;
      if (aspect < 0.2 || aspect > 5) continue;
      return { url: candidate.url, raster: asset.buffer };
    } catch {
      continue;
    }
  }
  return null;
}

/** Dominant non-neutral colors of the logo (coarse 32-step quantization). */
async function quantizeLogoColors(buffer: Buffer): Promise<WeightedColor[]> {
  try {
    const { data, info } = await sharp(buffer)
      .resize(48, 48, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const counts = new Map<string, { r: number; g: number; b: number; n: number }>();
    for (let i = 0; i + 3 < data.length; i += info.channels) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 128) continue;
      const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
      const bucket = counts.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
      bucket.r += r; bucket.g += g; bucket.b += b; bucket.n += 1;
      counts.set(key, bucket);
    }

    return [...counts.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 6)
      .map((bucket) => ({
        hex: rgbToHex(
          Math.round(bucket.r / bucket.n),
          Math.round(bucket.g / bucket.n),
          Math.round(bucket.b / bucket.n),
        ),
        weight: 5 * (bucket.n / (48 * 48)) * 10,
      }))
      .filter((c) => !isNeutral(c.hex));
  } catch {
    return [];
  }
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

    const jsonLd = extractJsonLdBrand(html);
    const title = getTitle(html);

    // Enrichment fetches run in parallel; each is individually best-effort
    // and time-capped so the scan always answers within the UI's budget.
    const manifestHref = findManifestHref(html, finalUrl);
    const stylesheetHrefs = findStylesheetHrefs(html, finalUrl, MAX_STYLESHEETS);

    const [manifestAsset, ...cssAssets] = await Promise.all([
      manifestHref ? fetchAsset(manifestHref, MAX_MANIFEST_BYTES) : Promise.resolve(null),
      ...stylesheetHrefs.map((href) => fetchAsset(href, MAX_CSS_BYTES)),
    ]);

    const manifest = manifestAsset
      ? parseManifest(manifestAsset.buffer.toString('utf8'), finalUrl)
      : null;

    // Logo: ranked candidates (never og:image), validated by actually
    // decoding the bytes. Manifest icons slot in after apple-touch-icon.
    const candidates = collectLogoCandidates(html, finalUrl, jsonLd);
    for (const icon of manifest?.icons.slice(0, 1) ?? []) {
      if (!candidates.some((c) => c.url === icon.src)) {
        candidates.push({ url: icon.src, source: 'manifest' });
      }
    }
    // Last resort: the conventional favicon path, even when undeclared.
    const rootFavicon = new URL('/favicon.ico', finalUrl.origin).toString();
    if (!candidates.some((c) => c.url === rootFavicon)) {
      candidates.push({ url: rootFavicon, source: 'root-favicon' });
    }
    const logo = await validateLogo(candidates);

    // Colors: named CSS brand properties and literal frequency, the
    // manifest/meta theme colors, and the logo's own dominant colors.
    const colorCandidates: WeightedColor[] = [];
    const css =
      extractInlineStyles(html) +
      '\n' +
      cssAssets
        .filter((asset): asset is NonNullable<typeof asset> => asset !== null)
        .map((asset) => asset.buffer.toString('utf8'))
        .join('\n');
    colorCandidates.push(...extractCssColors(css));

    const metaTheme = normalizeColor(getMetaContent(html, 'theme-color'));
    if (metaTheme && !isNeutral(metaTheme)) colorCandidates.push({ hex: metaTheme, weight: 6 });
    if (manifest?.themeColor && !isNeutral(manifest.themeColor)) {
      colorCandidates.push({ hex: manifest.themeColor, weight: 8 });
    }
    if (logo?.raster) colorCandidates.push(...(await quantizeLogoColors(logo.raster)));

    const palette = pickPalette(colorCandidates);
    const description = pickDescription(html, jsonLd);

    return apiOk({
      name: pickName(html, jsonLd) || manifest?.name || '',
      description,
      category: '',
      pricingTier: '',
      tags: extractTags(html, title, description),
      primaryColor: palette.primaryColor,
      secondaryColor: palette.secondaryColor,
      accentColor: palette.accentColor,
      logoUrl: logo?.url ?? '',
      targetAudience: '',
      tone: '',
    });
  } catch (error) {
    return apiError(error);
  }
}
