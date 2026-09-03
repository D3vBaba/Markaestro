// Pure extraction helpers for the website brand scan. Everything here is
// deterministic and side-effect free so it can be unit tested against HTML
// fixtures; all network I/O stays in the API route.

// ── HTML primitives ───────────────────────────────────────────────────────

export function decodeHtmlEntities(value: string): string {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getMetaContent(html: string, key: string): string {
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

export function getTitle(html: string): string {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  return decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim();
}

export function resolveUrl(href: string, base: URL): string {
  try {
    const resolved = new URL(decodeHtmlEntities(href.trim()), base);
    return ['http:', 'https:'].includes(resolved.protocol) ? resolved.toString() : '';
  } catch {
    return '';
  }
}

type LinkTag = { rel: string; href: string; sizes: string; type: string };

export function parseLinkTags(html: string): LinkTag[] {
  const out: LinkTag[] = [];
  for (const tag of html.match(/<link\s[^>]*>/gi) ?? []) {
    const rel = (tag.match(/rel\s*=\s*["']([^"']*)["']/i)?.[1] ?? '').toLowerCase();
    const href = tag.match(/href\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    const sizes = (tag.match(/sizes\s*=\s*["']([^"']*)["']/i)?.[1] ?? '').toLowerCase();
    const type = (tag.match(/type\s*=\s*["']([^"']*)["']/i)?.[1] ?? '').toLowerCase();
    if (rel && href) out.push({ rel, href, sizes, type });
  }
  return out;
}

// ── JSON-LD ───────────────────────────────────────────────────────────────

export type JsonLdBrand = { name: string; description: string; logo: string };

type JsonLdNode = Record<string, unknown>;

function jsonLdNodes(value: unknown): JsonLdNode[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdNodes);
  if (value && typeof value === 'object') {
    const node = value as JsonLdNode;
    const nested = Array.isArray(node['@graph']) ? jsonLdNodes(node['@graph']) : [];
    return [node, ...nested];
  }
  return [];
}

function jsonLdString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const url = (value as JsonLdNode).url;
    if (typeof url === 'string') return url.trim();
  }
  return '';
}

/** Pulls name/description/logo from Organization / WebSite / Product nodes. */
export function extractJsonLdBrand(html: string): JsonLdBrand {
  const result: JsonLdBrand = { name: '', description: '', logo: '' };
  const WANTED = new Set(['organization', 'website', 'webapplication', 'softwareapplication', 'product', 'brand', 'localbusiness']);

  const blocks = html.match(
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  ) ?? [];
  for (const block of blocks) {
    const raw = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const node of jsonLdNodes(parsed)) {
      const types = ([] as unknown[]).concat(node['@type'] ?? []).map((t) => String(t).toLowerCase());
      if (!types.some((t) => WANTED.has(t))) continue;
      if (!result.name && typeof node.name === 'string') result.name = node.name.trim();
      if (!result.description && typeof node.description === 'string') {
        result.description = node.description.trim();
      }
      if (!result.logo) result.logo = jsonLdString(node.logo) || jsonLdString(node.image);
    }
  }
  return result;
}

// ── Name & description ────────────────────────────────────────────────────

/** "Acme — Ship faster" and "Pricing | Acme" both segment to "Acme": the
    brand name is almost always the shortest segment. */
function brandSegment(text: string): string {
  const segments = text
    .split(/\s*[|•·\u2013\u2014]\s*|\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return '';
  if (segments.length === 1) return segments[0];
  const first = segments[0];
  const last = segments[segments.length - 1];
  return last.length < first.length ? last : first;
}

export function pickName(html: string, jsonLd: JsonLdBrand): string {
  const siteName = getMetaContent(html, 'og:site_name');
  if (siteName) return siteName;
  if (jsonLd.name) return jsonLd.name;

  const appName = getMetaContent(html, 'application-name');
  if (appName) return appName;

  const ogTitle = getMetaContent(html, 'og:title');
  const fromOg = brandSegment(ogTitle);
  if (fromOg) return fromOg;

  return brandSegment(getTitle(html));
}

const BOILERPLATE_PATTERN =
  /cookie|privacy|javascript|browser|sign in|log in|subscribe|newsletter|copyright|all rights reserved/i;

/** First substantial paragraph of body copy — the fallback when meta
    descriptions are missing or cut off mid-sentence. */
export function extractLeadParagraph(html: string): string {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');

  for (const match of body.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) ?? []) {
    const text = decodeHtmlEntities(match.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < 60 || text.length > 600) continue;
    if (BOILERPLATE_PATTERN.test(text)) continue;
    return text;
  }
  return '';
}

const MAX_DESCRIPTION_CHARS = 300;

/** True when the text reads as cut off: trailing ellipsis, a dangling
    function word, or no terminal punctuation on a longer sentence. */
export function looksTruncated(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/(\.\.\.|…)$/.test(t)) return true;
  if (/[.!?"')\]]$/.test(t)) return false;
  // "…built for indie developers who" — a trailing article, conjunction, or
  // pronoun means the sentence never finished.
  if (/\b(?:a|an|the|and|or|but|for|to|of|in|on|at|with|who|whom|that|which|your|our|their|is|are|was|were|be|by|as|from)$/i.test(t)) {
    return true;
  }
  return t.length > 60;
}

/** Trims to complete sentences within the budget; strips dangling fragments. */
export function cleanDescription(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim().replace(/(\.\.\.|…)$/, '').trim();
  if (!t) return '';

  if (t.length > MAX_DESCRIPTION_CHARS) {
    t = t.slice(0, MAX_DESCRIPTION_CHARS);
  }

  // Prefer ending on a sentence boundary. Only drop a trailing fragment when
  // a reasonably long complete sentence remains.
  const lastStop = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '));
  const endsComplete = /[.!?]$/.test(t);
  if (!endsComplete && lastStop >= 50) {
    t = t.slice(0, lastStop + 1);
  }
  return t.trim();
}

export function pickDescription(html: string, jsonLd: JsonLdBrand): string {
  const candidates = [
    getMetaContent(html, 'og:description'),
    getMetaContent(html, 'description'),
    getMetaContent(html, 'twitter:description'),
    jsonLd.description,
  ].filter(Boolean);

  const intact = candidates.find((c) => !looksTruncated(c));
  if (intact) return cleanDescription(intact);

  // Every meta description is missing or cut off — try real page copy before
  // settling for a truncated snippet.
  const lead = extractLeadParagraph(html);
  if (lead && !looksTruncated(lead)) return cleanDescription(lead);

  return cleanDescription(candidates[0] ?? lead ?? '');
}

// ── Logo candidates ───────────────────────────────────────────────────────

export type LogoCandidate = { url: string; source: string };

function iconSize(sizes: string): number {
  // "180x180" | "any" | "" — treat SVG-ish "any" as large.
  if (sizes === 'any') return 512;
  return Number(sizes.match(/(\d+)x\d+/)?.[1] ?? 0);
}

/** Ranked logo candidates. og:image is deliberately excluded — it is the
    social share card, not the logo. */
export function collectLogoCandidates(html: string, baseUrl: URL, jsonLd: JsonLdBrand): LogoCandidate[] {
  const candidates: LogoCandidate[] = [];
  const push = (href: string, source: string) => {
    const resolved = resolveUrl(href, baseUrl);
    if (resolved && !candidates.some((c) => c.url === resolved)) {
      candidates.push({ url: resolved, source });
    }
  };

  if (jsonLd.logo) push(jsonLd.logo, 'json-ld');

  // Explicitly declared logos — rare, but authoritative when present.
  const ogLogo = getMetaContent(html, 'og:logo');
  if (ogLogo) push(ogLogo, 'og-logo');
  const itempropLogo = html.match(
    /<(?:img|meta)\s[^>]*itemprop\s*=\s*["']logo["'][^>]*>/i,
  )?.[0];
  if (itempropLogo) {
    const src =
      itempropLogo.match(/(?:src|content)\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    if (src) push(src, 'itemprop-logo');
  }

  // <img> tags that look like a logo, favoring ones inside <header>/<nav>.
  const imgTags = html.match(/<img\s[^>]*>/gi) ?? [];
  const headerHtml = (html.match(/<header[\s>][\s\S]*?<\/header>/i)?.[0] ?? '')
    + (html.match(/<nav[\s>][\s\S]*?<\/nav>/i)?.[0] ?? '');
  const scoreImg = (tag: string): number => {
    const src = tag.match(/src\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    if (!src || src.startsWith('data:')) return -1;
    const hints = `${tag.match(/class\s*=\s*["']([^"']*)["']/i)?.[1] ?? ''} ${
      tag.match(/id\s*=\s*["']([^"']*)["']/i)?.[1] ?? ''} ${
      tag.match(/alt\s*=\s*["']([^"']*)["']/i)?.[1] ?? ''} ${src}`.toLowerCase();
    if (!hints.includes('logo')) return -1;
    let score = 1;
    if (headerHtml.includes(tag)) score += 2;
    if (/\.svg(\?|$)/i.test(src)) score += 1;
    return score;
  };
  const scored = imgTags
    .map((tag) => ({ tag, score: scoreImg(tag) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  for (const { tag } of scored.slice(0, 2)) {
    const src = tag.match(/src\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    push(src, 'img-logo');
  }

  const links = parseLinkTags(html);
  const appleIcons = links
    .filter((l) => l.rel.includes('apple-touch-icon'))
    .sort((a, b) => iconSize(b.sizes) - iconSize(a.sizes));
  for (const icon of appleIcons.slice(0, 1)) push(icon.href, 'apple-touch-icon');

  const icons = links
    .filter((l) => l.rel.split(/\s+/).includes('icon'))
    .sort((a, b) => {
      // Prefer real sizes, then svg/png over ico.
      const sizeDiff = iconSize(b.sizes) - iconSize(a.sizes);
      if (sizeDiff !== 0) return sizeDiff;
      const rank = (l: LinkTag) => (/svg/.test(l.type + l.href) ? 2 : /png/.test(l.type + l.href) ? 1 : 0);
      return rank(b) - rank(a);
    });
  for (const icon of icons.slice(0, 2)) push(icon.href, 'icon');

  return candidates;
}

export function findManifestHref(html: string, baseUrl: URL): string {
  const link = parseLinkTags(html).find((l) => l.rel.split(/\s+/).includes('manifest'));
  return link ? resolveUrl(link.href, baseUrl) : '';
}

export function findStylesheetHrefs(html: string, baseUrl: URL, limit: number): string[] {
  const out: string[] = [];
  for (const link of parseLinkTags(html)) {
    if (!link.rel.split(/\s+/).includes('stylesheet')) continue;
    const resolved = resolveUrl(link.href, baseUrl);
    if (!resolved) continue;
    // Same-origin only: third-party CSS (fonts, widgets) carries no brand
    // colors and blows the time budget.
    try {
      if (new URL(resolved).origin !== baseUrl.origin) continue;
    } catch {
      continue;
    }
    if (!out.includes(resolved)) out.push(resolved);
    if (out.length >= limit) break;
  }
  return out;
}

export function extractInlineStyles(html: string): string {
  return (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? [])
    .map((block) => block.replace(/^<style[^>]*>/i, '').replace(/<\/style>$/i, ''))
    .join('\n');
}

// ── Color science ─────────────────────────────────────────────────────────

export type WeightedColor = { hex: string; weight: number };

export function normalizeColor(raw: string): string | null {
  const value = raw.trim().toLowerCase();

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return `#${h.toUpperCase()}`;
  }

  const rgb = value.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)));
    return rgbToHex(r, g, b);
  }
  return null;
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/** Backgrounds, borders, and text colors — not brand colors. */
export function isNeutral(hex: string): boolean {
  const { s, l } = hexToHsl(hex);
  return s < 0.15 || l > 0.92 || l < 0.08;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

const BRAND_PROP_PATTERN =
  /--[\w-]*(?:primary|brand|accent|secondary|theme|main|cta|highlight)[\w-]*\s*:\s*([^;}]+)[;}]/gi;
const COLOR_LITERAL_PATTERN =
  /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b|rgba?\(\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*[, ]\s*\d{1,3}[^)]*\)/gi;

/** Weighted color candidates from CSS text: named brand custom properties
    count for a lot; raw literal frequency counts for a little. */
export function extractCssColors(css: string): WeightedColor[] {
  const weights = new Map<string, number>();
  const add = (hex: string | null, weight: number) => {
    if (!hex || isNeutral(hex)) return;
    weights.set(hex, (weights.get(hex) ?? 0) + weight);
  };

  for (const match of css.matchAll(BRAND_PROP_PATTERN)) {
    add(normalizeColor(match[1] ?? ''), 10);
  }

  const counts = new Map<string, number>();
  for (const match of css.match(COLOR_LITERAL_PATTERN) ?? []) {
    const hex = normalizeColor(match);
    if (!hex || isNeutral(hex)) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  for (const [hex, count] of counts) {
    add(hex, Math.min(4, 1 + Math.log2(count)));
  }

  return [...weights.entries()].map(([hex, weight]) => ({ hex, weight }));
}

export type Palette = { primaryColor: string; secondaryColor: string; accentColor: string };

/** Merges weighted candidates into primary/secondary/accent: rank by
    weight × vividness, then keep hues that are actually distinct. */
export function pickPalette(candidates: WeightedColor[]): Palette {
  const merged = new Map<string, number>();
  for (const { hex, weight } of candidates) {
    if (isNeutral(hex)) continue;
    merged.set(hex, (merged.get(hex) ?? 0) + weight);
  }

  const ranked = [...merged.entries()]
    .map(([hex, weight]) => ({ hex, weight, hsl: hexToHsl(hex) }))
    .sort((a, b) => b.weight * (0.4 + 0.6 * b.hsl.s) - a.weight * (0.4 + 0.6 * a.hsl.s));

  const picked: { hex: string; hsl: { h: number; s: number; l: number } }[] = [];
  for (const c of ranked) {
    const distinct = picked.every(
      (p) => hueDistance(p.hsl.h, c.hsl.h) >= 25 || Math.abs(p.hsl.l - c.hsl.l) >= 0.25,
    );
    if (distinct) picked.push({ hex: c.hex, hsl: c.hsl });
    if (picked.length === 3) break;
  }

  return {
    primaryColor: picked[0]?.hex ?? '',
    secondaryColor: picked[1]?.hex ?? '',
    accentColor: picked[2]?.hex ?? picked[1]?.hex ?? '',
  };
}

// ── Web app manifest ──────────────────────────────────────────────────────

export type ManifestBrand = {
  name: string;
  themeColor: string | null;
  icons: { src: string; size: number }[];
};

export function parseManifest(json: string, baseUrl: URL): ManifestBrand {
  const empty: ManifestBrand = { name: '', themeColor: null, icons: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== 'object') return empty;
  const m = parsed as Record<string, unknown>;

  const icons = Array.isArray(m.icons)
    ? m.icons
        .map((icon) => {
          const node = icon as Record<string, unknown>;
          const src = typeof node.src === 'string' ? resolveUrl(node.src, baseUrl) : '';
          const size = Number(String(node.sizes ?? '').match(/(\d+)x\d+/)?.[1] ?? 0);
          return { src, size };
        })
        .filter((icon) => icon.src)
        .sort((a, b) => b.size - a.size)
    : [];

  return {
    name: typeof m.name === 'string' ? m.name.trim() : '',
    themeColor:
      typeof m.theme_color === 'string' ? normalizeColor(m.theme_color) : null,
    icons,
  };
}

// ── Bot challenges ────────────────────────────────────────────────────────

/** Markers of an interstitial served instead of the site: Cloudflare's
    managed challenge and its cousins. A scan that reads one of these would
    present the challenge vendor's colors and copy as the brand's. */
const CHALLENGE_TITLE = /just a moment|attention required|performing security verification|verify you are human|checking your browser|security checkpoint|access denied|bot verification|are you a robot/i;
const CHALLENGE_BODY = /\/cdn-cgi\/challenge-platform\/|id=["']challenge-(?:running|error|body|form|stage)|cf-turnstile|cf_chl_|px-captcha|_Incapsula_Resource|ddos-guard|enable javascript and cookies to continue|vercel security checkpoint/i;

export function isBotChallengePage(html: string): boolean {
  const head = html.slice(0, 200_000);
  return CHALLENGE_TITLE.test(getTitle(head)) || CHALLENGE_BODY.test(head);
}

/** The same markers, for model output that read a challenge page. */
export function looksLikeChallengeText(text: string): boolean {
  return CHALLENGE_TITLE.test(text) || /security service to protect against malicious bots|cloudflare ray id/i.test(text);
}
