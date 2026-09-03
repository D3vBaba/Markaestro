// Cloudflare Browser Rendering integration for the website brand scan.
//
// The deterministic scan in scan-extract.ts reads raw HTML and is good at
// logos and colors, but it cannot see JavaScript-rendered pages and it only
// guesses at semantic fields (category, audience, tone) from meta tags.
// Cloudflare renders the page in a real browser and its /json quick action
// runs an LLM over the rendered content against our schema, so the brand
// fields come from reading the site rather than from keyword heuristics.
//
// Everything here is best-effort: when the account is not configured or a
// call fails, callers get null and fall back to the deterministic scan.

import { logger } from '@/lib/logger';
import { productCategories } from '@/lib/schemas';
import { cleanDescription } from '@/lib/products/scan-extract';

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4/accounts';
/** Whole-request budget for the /json call (render + model). */
const JSON_TIMEOUT_MS = 30_000;
/** Whole-request budget for the /content call (render only). */
const CONTENT_TIMEOUT_MS = 20_000;
/** How long the headless browser waits for the page itself. */
const PAGE_LOAD_TIMEOUT_MS = 20_000;
/** Pause after the load event so hydrated content is on the page. */
const SETTLE_MS = 1_500;
const MAX_RENDERED_HTML_BYTES = 2 * 1024 * 1024;
/** The free Browser Rendering tier allows one quick action per ten seconds.
    One retry after Retry-After (capped) covers a lone user; sustained
    traffic needs the paid tier, which allows thirty per second. */
const RETRY_AFTER_DEFAULT_MS = 10_000;
const RETRY_AFTER_MAX_MS = 12_000;
const MAX_TAGS = 6;
const MAX_TAG_CHARS = 40;
const MAX_NAME_CHARS = 120;
const MAX_TONE_CHARS = 200;
const MAX_AUDIENCE_CHARS = 500;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const scanPricingTiers = [
  'free', 'freemium', 'paid', 'subscription', 'enterprise', 'custom',
] as const;
export type ScanPricingTier = (typeof scanPricingTiers)[number];

export type CloudflareBrand = {
  name: string;
  description: string;
  category: string;
  pricingTier: string;
  tags: string[];
  targetAudience: string;
  tone: string;
};

export type CloudflareScanConfig = { accountId: string; apiToken: string };

export function getCloudflareScanConfig(): CloudflareScanConfig | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '';
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? '';
  return accountId && apiToken ? { accountId, apiToken } : null;
}

/** JSON schema handed to Cloudflare's extraction model. Kept hand-written so
    each field carries the guidance the model needs; the zod product schema
    is the storage contract, not an extraction brief. */
export const BRAND_JSON_SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description:
        'The brand, company, product, or person the site is about. The proper name only, without taglines, slogans, or page titles.',
    },
    description: {
      type: 'string',
      description:
        'One to three plain sentences on what this brand offers and to whom, written from the site content. No marketing hype, no first person.',
    },
    category: {
      type: 'string',
      enum: [...productCategories],
      description:
        'The single category that best fits what the brand actually sells or does, chosen from the category guide in the instructions. Use "other" only when nothing else fits.',
    },
    pricingTier: {
      type: 'string',
      enum: [...scanPricingTiers, ''],
      description:
        'How the brand charges, if the site says so: free, freemium, paid (one-time), subscription, enterprise (contact sales), or custom. Empty string when the site does not say.',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Up to six short lowercase topic tags describing the products, services, or themes of the site.',
    },
    targetAudience: {
      type: 'string',
      description:
        'Who the brand is for, in one or two sentences, based on the language and offers on the site. Empty string when unclear.',
    },
    tone: {
      type: 'string',
      description:
        'Three to five comma-separated adjectives that describe the voice of this specific site copy. Empty string when there is too little copy to judge.',
    },
  },
  required: ['name', 'description', 'category', 'pricingTier', 'tags', 'targetAudience', 'tone'],
} as const;

/** Category guide the model reads before choosing. The enum alone tempts a
    model to pick the first plausible entry, which is "saas", for a shoe shop. */
const CATEGORY_GUIDE = [
  'Software categories, only when the offer itself is software: saas (web-based software), mobile (a mobile app), web (a web app or site product), api, developer-tools, ai (AI products), productivity, fintech, healthtech, edtech, gaming, social, marketplace (a platform connecting buyers and sellers).',
  'Everything else: ecommerce (sells physical goods online), fashion-beauty (clothing, footwear, cosmetics, skincare), food-restaurant, music-entertainment, real-estate, coaching-services (coaches, consultants, professional services), fitness, travel-hospitality, local-business (a physical venue serving a local area), personal-brand (an individual person), creator (content creator or influencer), media (publications, podcasts, studios), agency (marketing, design, or dev agency), hardware (physical tech devices), nonprofit, other.',
  'A brand that sells shoes, clothing, food, or services is never saas, even if it has an online store or an app.',
].join(' ');

const BRAND_PROMPT = [
  'You are analyzing a brand website for a social media marketing tool.',
  'Read the rendered page as a whole and describe the brand it belongs to.',
  'Interpret what the business actually does from the content; do not infer the category from isolated keywords.',
  'Category guide: ' + CATEGORY_GUIDE,
  'Only report what the page supports. Leave a field as an empty string (or an empty list) when the page does not support it.',
  'Describe this site in its own terms; do not reuse wording from these instructions.',
  'Ignore cookie banners, navigation chrome, and legal boilerplate.',
].join(' ');

const CATEGORY_SET: ReadonlySet<string> = new Set(productCategories);
const PRICING_SET: ReadonlySet<string> = new Set(scanPricingTiers);

function str(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/** Coerces whatever the model returned into the scan contract. Pure, so it
    is unit tested against representative model output. */
export function normalizeCloudflareBrand(raw: unknown): CloudflareBrand | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const category = str(r.category, 40).toLowerCase();
  const pricingTier = str(r.pricingTier, 40).toLowerCase();

  const tags: string[] = [];
  if (Array.isArray(r.tags)) {
    for (const tag of r.tags) {
      const t = str(tag, MAX_TAG_CHARS).toLowerCase();
      if (t && !tags.includes(t)) tags.push(t);
      if (tags.length >= MAX_TAGS) break;
    }
  }

  const brand: CloudflareBrand = {
    name: str(r.name, MAX_NAME_CHARS),
    description: cleanDescription(str(r.description, 2000)),
    category: CATEGORY_SET.has(category) ? category : '',
    pricingTier: PRICING_SET.has(pricingTier) ? pricingTier : '',
    tags,
    targetAudience: str(r.targetAudience, MAX_AUDIENCE_CHARS),
    tone: str(r.tone, MAX_TONE_CHARS),
  };

  // A response with nothing in it is worse than no response: the caller
  // would skip its own extraction for empty strings.
  const hasContent = Object.values(brand).some((v) => (Array.isArray(v) ? v.length > 0 : v !== ''));
  return hasContent ? brand : null;
}

type QuickAction = 'json' | 'content' | 'links' | 'markdown' | 'screenshot';

type QuickActionOptions = {
  /** Screenshots need the page's images and fonts; text actions do not. */
  keepAssets?: boolean;
};

function retryDelayMs(res: Response): number {
  const header = Number(res.headers.get('retry-after'));
  const ms = Number.isFinite(header) && header >= 0 ? header * 1000 : RETRY_AFTER_DEFAULT_MS;
  return Math.min(ms, RETRY_AFTER_MAX_MS);
}

async function callQuickAction(
  config: CloudflareScanConfig,
  action: QuickAction,
  body: Record<string, unknown>,
  timeoutMs: number,
  options: QuickActionOptions = {},
): Promise<Response> {
  const first = await sendQuickAction(config, action, body, timeoutMs, options);
  if (first.status !== 429) return first;
  const delay = retryDelayMs(first);
  logger.info('cloudflare quick action rate limited, retrying once', {
    event: 'products.scan.cloudflare_rate_limited',
    action,
    delayMs: delay,
  });
  await new Promise((resolve) => setTimeout(resolve, delay));
  return sendQuickAction(config, action, body, timeoutMs, options);
}

async function sendQuickAction(
  config: CloudflareScanConfig,
  action: QuickAction,
  body: Record<string, unknown>,
  timeoutMs: number,
  options: QuickActionOptions,
): Promise<Response> {
  return fetch(`${CLOUDFLARE_API}/${encodeURIComponent(config.accountId)}/browser-rendering/${action}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...body,
      userAgent: USER_AGENT,
      // 'load' rather than 'networkidle0': marketing sites keep analytics
      // beacons open, so idle never arrives and the render times out. A short
      // settle delay after load lets client-rendered shells paint their copy.
      gotoOptions: { waitUntil: 'load', timeout: PAGE_LOAD_TIMEOUT_MS },
      waitForTimeout: SETTLE_MS,
      // Text actions do not need heavy assets; skipping them keeps the
      // billed browser time down and the page load inside its timeout.
      ...(options.keepAssets ? {} : { rejectResourceTypes: ['image', 'media', 'font'] }),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function browserMs(res: Response): number | null {
  const raw = res.headers.get('x-browser-ms-used');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Renders the page and asks Cloudflare's extraction model for the brand
    fields. Null when unconfigured or on any failure. The caller must pass a
    URL that already passed assertSafeOutboundUrl. */
export async function extractBrandWithCloudflare(url: string): Promise<CloudflareBrand | null> {
  const config = getCloudflareScanConfig();
  if (!config) return null;
  const startedAt = Date.now();
  try {
    const res = await callQuickAction(
      config,
      'json',
      {
        url,
        prompt: BRAND_PROMPT,
        response_format: { type: 'json_schema', json_schema: BRAND_JSON_SCHEMA },
      },
      JSON_TIMEOUT_MS,
    );
    const payload = (await res.json().catch(() => null)) as
      | { success?: boolean; result?: unknown; errors?: Array<{ code?: number; message?: string }> }
      | null;
    if (!res.ok || !payload?.success) {
      logger.warn('cloudflare brand extraction failed', {
        event: 'products.scan.cloudflare_json_failed',
        status: res.status,
        error: payload?.errors?.[0]?.message ?? '',
        latencyMs: Date.now() - startedAt,
      });
      return null;
    }
    const brand = normalizeCloudflareBrand(payload.result);
    logger.info('cloudflare brand extraction', {
      event: 'products.scan.cloudflare_json',
      browserMs: browserMs(res),
      latencyMs: Date.now() - startedAt,
      empty: brand === null,
    });
    return brand;
  } catch (err) {
    logger.warn('cloudflare brand extraction errored', {
      event: 'products.scan.cloudflare_json_error',
      error: err instanceof Error ? err.message : 'unknown',
      latencyMs: Date.now() - startedAt,
    });
    return null;
  }
}

/** Fully rendered HTML for pages the plain fetch cannot read (client-side
    rendered shells). Null when unconfigured or on any failure. */
export async function renderHtmlWithCloudflare(url: string): Promise<string | null> {
  const config = getCloudflareScanConfig();
  if (!config) return null;
  const startedAt = Date.now();
  try {
    const res = await callQuickAction(config, 'content', { url }, CONTENT_TIMEOUT_MS);
    if (!res.ok) {
      logger.warn('cloudflare page render failed', {
        event: 'products.scan.cloudflare_content_failed',
        status: res.status,
        latencyMs: Date.now() - startedAt,
      });
      return null;
    }
    const text = await res.text();
    // Cloudflare wraps the HTML in its envelope when the client asks for
    // JSON; either way we only want the document.
    let html = text;
    if (res.headers.get('content-type')?.includes('application/json')) {
      const payload = JSON.parse(text) as { success?: boolean; result?: unknown };
      if (!payload.success || typeof payload.result !== 'string') return null;
      html = payload.result;
    }
    if (!/<html[\s>]|<body[\s>]|<head[\s>]/i.test(html.slice(0, 4096))) return null;
    logger.info('cloudflare page render', {
      event: 'products.scan.cloudflare_content',
      browserMs: browserMs(res),
      latencyMs: Date.now() - startedAt,
    });
    return html.slice(0, MAX_RENDERED_HTML_BYTES);
  } catch (err) {
    logger.warn('cloudflare page render errored', {
      event: 'products.scan.cloudflare_content_error',
      error: err instanceof Error ? err.message : 'unknown',
      latencyMs: Date.now() - startedAt,
    });
    return null;
  }
}

/** Reads the JSON envelope every text quick action returns. */
async function readEnvelope<T>(res: Response, event: string, startedAt: number): Promise<T | null> {
  const payload = (await res.json().catch(() => null)) as
    | { success?: boolean; result?: T; errors?: Array<{ message?: string }> }
    | null;
  if (!res.ok || !payload?.success || payload.result === undefined) {
    logger.warn('cloudflare quick action failed', {
      event,
      status: res.status,
      error: payload?.errors?.[0]?.message ?? '',
      latencyMs: Date.now() - startedAt,
    });
    return null;
  }
  return payload.result;
}

/** Same-origin links on the page, absolute and deduplicated. Null when
    unconfigured or on failure. */
export async function listLinksWithCloudflare(url: string): Promise<string[] | null> {
  const config = getCloudflareScanConfig();
  if (!config) return null;
  const startedAt = Date.now();
  try {
    const res = await callQuickAction(
      config,
      'links',
      { url, excludeExternalLinks: true, visibleLinksOnly: false },
      CONTENT_TIMEOUT_MS,
    );
    const links = await readEnvelope<unknown>(res, 'products.scan.cloudflare_links_failed', startedAt);
    if (!Array.isArray(links)) return null;
    return Array.from(new Set(links.filter((l): l is string => typeof l === 'string')));
  } catch (err) {
    logger.warn('cloudflare links errored', {
      event: 'products.scan.cloudflare_links_error',
      error: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}

/** Rendered page as Markdown: the cheapest faithful input for a model,
    a fraction of the tokens of the HTML and none of the script noise. */
export async function markdownWithCloudflare(url: string): Promise<string | null> {
  const config = getCloudflareScanConfig();
  if (!config) return null;
  const startedAt = Date.now();
  try {
    const res = await callQuickAction(config, 'markdown', { url }, CONTENT_TIMEOUT_MS);
    const markdown = await readEnvelope<unknown>(res, 'products.scan.cloudflare_markdown_failed', startedAt);
    if (typeof markdown !== 'string' || !markdown.trim()) return null;
    logger.info('cloudflare markdown', {
      event: 'products.scan.cloudflare_markdown',
      browserMs: browserMs(res),
      latencyMs: Date.now() - startedAt,
      chars: markdown.length,
    });
    return markdown;
  } catch (err) {
    logger.warn('cloudflare markdown errored', {
      event: 'products.scan.cloudflare_markdown_error',
      error: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}

const SCREENSHOT_VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

/** Above-the-fold JPEG of the page. Null when unconfigured or on failure. */
export async function screenshotWithCloudflare(url: string): Promise<Buffer | null> {
  const config = getCloudflareScanConfig();
  if (!config) return null;
  const startedAt = Date.now();
  try {
    const res = await callQuickAction(
      config,
      'screenshot',
      {
        url,
        viewport: SCREENSHOT_VIEWPORT,
        screenshotOptions: { type: 'jpeg', quality: 80 },
      },
      CONTENT_TIMEOUT_MS,
      { keepAssets: true },
    );
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) {
      logger.warn('cloudflare screenshot failed', {
        event: 'products.scan.cloudflare_screenshot_failed',
        status: res.status,
        latencyMs: Date.now() - startedAt,
      });
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_SCREENSHOT_BYTES) return null;
    logger.info('cloudflare screenshot', {
      event: 'products.scan.cloudflare_screenshot',
      browserMs: browserMs(res),
      latencyMs: Date.now() - startedAt,
      bytes: bytes.length,
    });
    return bytes;
  } catch (err) {
    logger.warn('cloudflare screenshot errored', {
      event: 'products.scan.cloudflare_screenshot_error',
      error: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}
