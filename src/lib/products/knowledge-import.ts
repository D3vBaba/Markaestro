// Product knowledge import: reads a brand's website through Cloudflare
// Browser Rendering and fills the knowledge store with what the site
// actually says. The one-shot scan only sees the home page and only fills
// the wizard fields; this reads the pages that carry the substance (about,
// pricing, products, features) and produces the brief every generative
// feature draws on.

import { z } from 'zod';
import { generateStructured } from '@/lib/intelligence/ai-gateway';
import { logger } from '@/lib/logger';
import { productKnowledgeSchema } from '@/lib/schemas';
import {
  getCloudflareScanConfig,
  listLinksWithCloudflare,
  markdownWithCloudflare,
} from '@/lib/products/cloudflare-scan';

/** Pages read per import, home page included. */
export const MAX_IMPORT_PAGES = 6;
/** Per-page cap keeps the model input bounded; site copy rarely needs more. */
const MAX_PAGE_CHARS = 12_000;

/** Path words that usually mark the pages worth reading, best first. */
const PAGE_PRIORITY: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /\/(about|about-us|our-story|story|company|who-we-are|mission)\b/i, score: 10 },
  { pattern: /\/(pricing|plans|price|packages|membership)\b/i, score: 9 },
  { pattern: /\/(products?|features?|services?|solutions?|what-we-do|menu|collections?|shop|catalog)\b/i, score: 8 },
  { pattern: /\/(why|why-us|benefits|how-it-works|compare|vs)\b/i, score: 7 },
  { pattern: /\/(customers|case-studies|testimonials|reviews|results|press|awards)\b/i, score: 6 },
  { pattern: /\/(faq|faqs|help|support)\b/i, score: 4 },
  { pattern: /\/(team|founders|people)\b/i, score: 3 },
];

const SKIP_PATH = /\/(blog|news|login|signin|sign-in|signup|sign-up|register|account|cart|checkout|privacy|terms|legal|cookies?|careers|jobs|docs|api|wp-|tag|category|author|feed|rss|sitemap)\b|\.(pdf|jpe?g|png|gif|svg|webp|mp4|zip|xml|json)$/i;

/** How many pages of one kind (say, shop collections) an import reads.
    Breadth beats depth: an about page plus a pricing page tells the model
    more than four product listings. */
const MAX_PER_KIND = 2;

/** Picks the most informative same-origin pages, home first. Pure. */
export function selectKnowledgePages(links: string[], home: URL, max = MAX_IMPORT_PAGES): string[] {
  const homeKey = normalizeKey(home);
  const scored = new Map<string, { url: string; score: number; kind: number }>();
  for (const raw of links) {
    let link: URL;
    try {
      link = new URL(raw, home);
    } catch {
      continue;
    }
    if (link.origin !== home.origin) continue;
    if (SKIP_PATH.test(link.pathname)) continue;
    const key = normalizeKey(link);
    if (key === homeKey) continue;
    // Deep pages are usually individual items rather than overview pages.
    const depth = link.pathname.split('/').filter(Boolean).length;
    if (depth > 2) continue;
    let score = 0;
    let kind = -1;
    PAGE_PRIORITY.forEach(({ pattern, score: s }, i) => {
      if (pattern.test(link.pathname) && s > score) {
        score = s;
        kind = i;
      }
    });
    if (score === 0) continue;
    // Shorter paths win among equals: /pricing over /pricing/enterprise.
    score -= depth * 0.1;
    const existing = scored.get(key);
    if (!existing || existing.score < score) {
      link.hash = '';
      link.search = '';
      scored.set(key, { url: link.toString(), score, kind });
    }
  }
  const perKind = new Map<number, number>();
  const ranked: string[] = [];
  for (const page of [...scored.values()].sort((a, b) => b.score - a.score)) {
    const seen = perKind.get(page.kind) ?? 0;
    if (seen >= MAX_PER_KIND) continue;
    perKind.set(page.kind, seen + 1);
    ranked.push(page.url);
  }
  const homeUrl = new URL(home.toString());
  homeUrl.hash = '';
  return [homeUrl.toString(), ...ranked].slice(0, max);
}

function normalizeKey(url: URL): string {
  return `${url.origin}${url.pathname.replace(/\/+$/, '').toLowerCase()}`;
}

// Model-facing schema. Plain shapes only: Gemini's structured output rejects
// several JSON Schema keywords, so lengths are enforced after parsing.
const proofPointImport = z.object({
  type: z.enum(['stat', 'testimonial', 'award', 'press']),
  content: z.string().describe('The claim, number, quote, or award as the site states it.'),
  source: z.string().describe('Who said it or where it came from. Empty when the site does not say.'),
});

export const knowledgeImportSchema = z.object({
  features: z.array(z.object({
    title: z.string(),
    description: z.string().describe('What it does, in one sentence.'),
    benefit: z.string().describe('Why it matters to the customer. Empty when the site does not say.'),
  })).describe('Concrete features, products, services, or menu items the site offers.'),
  usps: z.array(z.string()).describe('Unique selling points the site claims, each one sentence.'),
  painPoints: z.array(z.string()).describe('Customer problems the site says it solves, each one sentence.'),
  proofPoints: z.array(proofPointImport).describe('Statistics, testimonials, awards, and press mentions found on the site.'),
  competitors: z.array(z.string()).describe('Competitors or alternatives the site names. Empty when none are named.'),
  differentiators: z.array(z.string()).describe('How the site says it differs from alternatives, each one sentence.'),
  positioning: z.string().describe('A two or three sentence positioning statement in the brand\'s own terms: who it is for, what it offers, and why it is different.'),
  targetAudienceDemographics: z.string().describe('Who the customers are, as the site describes them. Empty when unclear.'),
  targetAudiencePsychographics: z.string().describe('What those customers value or care about. Empty when unclear.'),
  targetAudiencePainStatement: z.string().describe('The core frustration the audience has, in one sentence. Empty when unclear.'),
  targetAudienceDesiredOutcome: z.string().describe('What the audience wants to achieve, in one sentence. Empty when unclear.'),
  contentAngles: z.array(z.string()).describe('Content themes the site itself leans on, each a short phrase.'),
});

export type KnowledgeImport = z.infer<typeof knowledgeImportSchema>;
export type ImportedKnowledge = Partial<z.infer<typeof productKnowledgeSchema>>;

const SYSTEM_PROMPT = [
  'You are building a product knowledge brief for a social media marketing tool.',
  'The untrusted content is the Markdown of several pages from one brand website, each headed by its URL.',
  'Extract only what the pages state or clearly show. Do not invent numbers, customers, or awards, and do not pad lists.',
  'Write in plain, specific language in the brand\'s own terms, never in marketing superlatives.',
  'Ignore navigation, cookie notices, footers, and legal text.',
  'Leave a field empty when the pages do not support it.',
].join(' ');

const cut = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n).trim();
const cutList = (items: string[], n: number, len: number) =>
  items.map((i) => cut(i, len)).filter(Boolean).slice(0, n);

/** Trims model output to the storage schema's limits and validates it. */
export function capImportedKnowledge(raw: KnowledgeImport): ImportedKnowledge {
  const capped = {
    features: raw.features
      .map((f) => ({ title: cut(f.title, 200), description: cut(f.description, 500), benefit: cut(f.benefit, 500) }))
      .filter((f) => f.title)
      .slice(0, 20),
    usps: cutList(raw.usps, 10, 300),
    painPoints: cutList(raw.painPoints, 10, 300),
    proofPoints: raw.proofPoints
      .map((p) => ({ type: p.type, content: cut(p.content, 1000), source: cut(p.source, 200) }))
      .filter((p) => p.content)
      .slice(0, 20),
    competitors: cutList(raw.competitors, 10, 200),
    differentiators: cutList(raw.differentiators, 10, 300),
    positioning: cut(raw.positioning, 1000),
    targetAudienceDemographics: cut(raw.targetAudienceDemographics, 500),
    targetAudiencePsychographics: cut(raw.targetAudiencePsychographics, 500),
    targetAudiencePainStatement: cut(raw.targetAudiencePainStatement, 500),
    targetAudienceDesiredOutcome: cut(raw.targetAudienceDesiredOutcome, 500),
    contentAngles: cutList(raw.contentAngles, 10, 300),
  };
  return productKnowledgeSchema.partial().parse(capped);
}

/** Fills only what the workspace has not written itself unless asked to
    overwrite. Arrays and strings count as written when non-empty. */
export function mergeImportedKnowledge(
  existing: Record<string, unknown>,
  imported: ImportedKnowledge,
  overwrite: boolean,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(imported)) {
    const current = existing[key];
    const currentFilled = Array.isArray(current) ? current.length > 0 : typeof current === 'string' && current.trim() !== '';
    const incomingFilled = Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim() !== '';
    if (!incomingFilled) continue;
    if (currentFilled && !overwrite) continue;
    merged[key] = value;
  }
  return merged;
}

export type SiteKnowledgeResult = {
  knowledge: ImportedKnowledge;
  pages: string[];
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

/** Reads the site and returns the extracted knowledge. Throws
    KNOWLEDGE_IMPORT_UNAVAILABLE when Cloudflare is not configured and
    KNOWLEDGE_IMPORT_EMPTY when no page could be read. */
export async function importKnowledgeFromSite(home: URL): Promise<SiteKnowledgeResult> {
  if (!getCloudflareScanConfig()) throw new Error('KNOWLEDGE_IMPORT_UNAVAILABLE');
  const startedAt = Date.now();

  const links = (await listLinksWithCloudflare(home.toString())) ?? [];
  const pages = selectKnowledgePages(links, home);
  const bodies = await Promise.all(pages.map((page) => markdownWithCloudflare(page)));

  const read: string[] = [];
  const sections: string[] = [];
  bodies.forEach((markdown, i) => {
    if (!markdown) return;
    read.push(pages[i]);
    sections.push(`## Page: ${pages[i]}\n\n${markdown.slice(0, MAX_PAGE_CHARS)}`);
  });
  if (sections.length === 0) throw new Error('KNOWLEDGE_IMPORT_EMPTY');

  const generated = await generateStructured({
    schema: knowledgeImportSchema,
    system: SYSTEM_PROMPT,
    untrustedContent: sections.join('\n\n'),
  });
  const knowledge = capImportedKnowledge(generated.value);

  logger.info('product knowledge imported from site', {
    event: 'products.knowledge_import',
    host: home.host,
    pagesSelected: pages.length,
    pagesRead: read.length,
    model: generated.model,
    latencyMs: Date.now() - startedAt,
  });

  return {
    knowledge,
    pages: read,
    model: generated.model,
    inputTokens: generated.inputTokens,
    outputTokens: generated.outputTokens,
  };
}
