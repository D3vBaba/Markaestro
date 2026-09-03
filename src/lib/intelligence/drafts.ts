import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { socialChannels, type SocialChannel } from '@/lib/schemas';
import { generateStructured } from './ai-gateway';
import type { ProductInsights } from './insights';
import type { AudienceIntelligenceProfile } from './schemas';
import type { OptimizationOpportunity } from './opportunities';
import type { BrandLearning } from './learnings';

/**
 * "Draft this": turn an opportunity, a learning, or an existing post into a
 * caption draft in the brand's voice. Everything the model sees is the brand's
 * own measured evidence plus its declared profile; the output is saved as a
 * Draft in Content and never scheduled or published from here.
 */
export const DRAFT_GENERATION_VERSION = 'draft-v1';

export const draftRequestSchema = z.object({
  productId: z.string().min(1).max(128),
  source: z.object({
    type: z.enum(['opportunity', 'learning', 'post']),
    id: z.string().min(1).max(200),
  }),
  platform: z.enum(socialChannels).optional(),
  /** BCP-47 tag of the UI; used only when the evidence captions have no language to mirror. */
  locale: z.string().max(12).optional(),
});

export type DraftRequest = z.infer<typeof draftRequestSchema>;

export const draftOutputSchema = z.object({
  caption: z.string().min(1).max(2200),
  hashtags: z.array(z.string().min(1).max(60)).max(15),
  hook: z.string().max(200).nullable(),
  rationale: z.string().min(1).max(600),
  evidenceIds: z.array(z.string().max(160)).max(10),
});

export type DraftOutput = z.infer<typeof draftOutputSchema>;

export type DraftEvidencePost = {
  id: string;
  /** Short human label the model uses in the rationale instead of the id. */
  label?: string;
  platform: string;
  content: string | null;
  publishedAt: string | null;
  views: number | null;
  engagements: number | null;
  engagementRate: number | null;
  objectiveValue: number | null;
  fingerprint: unknown;
};

export type DraftBrandContext = {
  name: string;
  description: string;
  url: string;
  voice: Record<string, unknown> | null;
};

export type DraftBrief = {
  version: string;
  language: string;
  platform: SocialChannel;
  brand: DraftBrandContext;
  audience: {
    objective: string;
    metric: string;
    markets: string[];
    pillars: string[];
    voice: string[];
    interests: string[];
    industries: string[];
    businessDescription: string;
  };
  source:
    | { type: 'opportunity'; kind: OptimizationOpportunity['kind']; params: OptimizationOpportunity['params']; title: string }
    | { type: 'learning'; dimension: BrandLearning['dimension']; key: string; effectPercent: number | null; observations: number; metric: string }
    | { type: 'post'; postId: string };
  bestWindow: { weekday: string; hour: string; timeZone: string; liftPercent: number | null } | null;
  evidence: DraftEvidencePost[];
};

export function sanitizeGeneratedCopy(text: string): string {
  return text
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/\s*\u2013\s*/g, ', ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function composeDraftContent(caption: string, hashtags: string[]): string {
  const cleanCaption = sanitizeGeneratedCopy(caption);
  const tags = [...new Set(hashtags
    .map((tag) => tag.trim().replace(/^#+/, '').replace(/\s+/g, ''))
    .filter(Boolean)
    .map((tag) => `#${tag}`))];
  if (tags.length === 0) return cleanCaption;
  const alreadyPresent = tags.every((tag) => cleanCaption.toLowerCase().includes(tag.toLowerCase()));
  return alreadyPresent ? cleanCaption : `${cleanCaption}\n\n${tags.join(' ')}`;
}

function byObjective(a: DraftEvidencePost, b: DraftEvidencePost): number {
  return (b.objectiveValue ?? b.views ?? Number.NEGATIVE_INFINITY) - (a.objectiveValue ?? a.views ?? Number.NEGATIVE_INFINITY);
}

function toEvidence(row: ProductInsights['rollup']['measuredPosts'][number]): DraftEvidencePost {
  return {
    id: row.id,
    platform: row.platform,
    content: row.content ? row.content.slice(0, 600) : null,
    publishedAt: row.publishedAt,
    views: row.views,
    engagements: row.engagements,
    engagementRate: row.engagementRate,
    objectiveValue: row.objectiveValue,
    fingerprint: row.fingerprint,
  };
}

export function resolveDraftPlatform(input: {
  requested?: SocialChannel;
  source: DraftBrief['source'];
  evidence: DraftEvidencePost[];
  profile: Pick<AudienceIntelligenceProfile, 'platformPriorities'>;
  channels: Array<{ platform: string }>;
}): SocialChannel {
  const isChannel = (value: unknown): value is SocialChannel => typeof value === 'string' && (socialChannels as readonly string[]).includes(value);
  if (input.requested) return input.requested;
  if (input.source.type === 'opportunity' && input.source.params.kind === 'platform' && isChannel(input.source.params.leader)) {
    return input.source.params.leader;
  }
  if (input.source.type === 'learning' && input.source.dimension === 'platform' && isChannel(input.source.key)) {
    return input.source.key;
  }
  const evidencePlatform = input.evidence.find((post) => isChannel(post.platform))?.platform;
  if (isChannel(evidencePlatform)) return evidencePlatform;
  const priority = input.profile.platformPriorities[0]?.platform;
  if (isChannel(priority)) return priority;
  const channel = input.channels.find((row) => isChannel(row.platform))?.platform;
  if (isChannel(channel)) return channel;
  return 'instagram';
}

/**
 * Pure brief assembly so it can be unit-tested without Firestore or Vertex.
 */
export function buildDraftBrief(input: {
  request: DraftRequest;
  insights: ProductInsights;
  brand: DraftBrandContext;
  sourcePost?: DraftEvidencePost | null;
}): DraftBrief {
  const { insights, request } = input;
  const profile = insights.profile;
  const measured = insights.rollup.measuredPosts.map(toEvidence);
  let source: DraftBrief['source'];
  let evidence: DraftEvidencePost[] = [];
  if (request.source.type === 'opportunity') {
    const opportunity = insights.opportunities.find((item) => item.id === request.source.id);
    if (!opportunity) throw new Error('NOT_FOUND');
    source = { type: 'opportunity', kind: opportunity.kind, params: opportunity.params, title: opportunity.title };
    if (opportunity.params.kind === 'platform') {
      const leader = opportunity.params.leader;
      evidence = measured.filter((post) => post.platform === leader).sort(byObjective).slice(0, 5);
    } else if (opportunity.params.kind === 'learning') {
      const ids = new Set(opportunity.evidenceIds);
      evidence = measured.filter((post) => ids.has(post.id)).sort(byObjective).slice(0, 5);
    }
    if (evidence.length === 0) evidence = [...measured].sort(byObjective).slice(0, 5);
  } else if (request.source.type === 'learning') {
    const learning = insights.learnings.find((item) => item.id === request.source.id);
    if (!learning) throw new Error('NOT_FOUND');
    source = {
      type: 'learning',
      dimension: learning.dimension,
      key: learning.key,
      effectPercent: learning.effectPercent,
      observations: learning.observations,
      metric: learning.metric,
    };
    const ids = new Set(learning.evidencePostIds);
    evidence = measured.filter((post) => ids.has(post.id)).sort(byObjective).slice(0, 5);
    if (evidence.length === 0) evidence = [...measured].sort(byObjective).slice(0, 5);
  } else {
    if (!input.sourcePost) throw new Error('NOT_FOUND');
    source = { type: 'post', postId: input.sourcePost.id };
    evidence = [input.sourcePost];
  }
  const platform = resolveDraftPlatform({
    requested: request.platform,
    source,
    evidence,
    profile,
    channels: insights.rollup.channels,
  });
  const best = insights.timing.windows[0];
  evidence = evidence.map((post, index) => ({
    ...post,
    label: `Evidence ${index + 1} (${post.platform}${post.publishedAt ? `, ${post.publishedAt.slice(0, 10)}` : ''})`,
  }));
  return {
    version: DRAFT_GENERATION_VERSION,
    language: request.locale || 'en',
    platform,
    brand: input.brand,
    audience: {
      objective: profile.objective,
      metric: insights.objective.metric,
      markets: profile.targetMarkets.map((market) => market.label),
      pillars: profile.contentPillars,
      voice: profile.brandVoice,
      interests: profile.interests,
      industries: profile.industries,
      businessDescription: profile.businessDescription.slice(0, 1500),
    },
    source,
    bestWindow: best ? { weekday: best.weekday, hour: best.hour, timeZone: insights.timing.timeZone, liftPercent: best.liftPercent } : null,
    evidence,
  };
}

const PLATFORM_GUIDANCE: Record<SocialChannel, string> = {
  instagram: 'Instagram caption: strong first line, line breaks for scanning, 3 to 8 relevant hashtags, at most 2200 characters.',
  facebook: 'Facebook post: conversational, 1 to 3 short paragraphs, hashtags optional (0 to 3).',
  tiktok: 'TikTok caption: short, punchy, under 300 characters, 3 to 5 hashtags.',
  threads: 'Threads post: casual and direct, under 500 characters, no more than 2 hashtags.',
  pinterest: 'Pinterest description: descriptive and keyword-rich, 1 to 2 sentences plus a clear reason to click, at most 500 characters.',
  linkedin: 'LinkedIn post: professional, an opening line that stands alone, short paragraphs, 2 to 5 hashtags, under 1500 characters.',
  x: 'X post: direct and conversational, with a strong opening, at most 280 characters, and no more than 2 hashtags.',
};

export function draftSystemPrompt(platform: SocialChannel): string {
  return [
    'You write one social media post draft for a brand, grounded strictly in the supplied brief.',
    PLATFORM_GUIDANCE[platform],
    'Reuse the structures, hooks, and topics that the evidence posts show performed well for this brand; do not copy them verbatim.',
    'Match the brand voice and the audience profile. Write in the same language as the evidence captions; if there are none, use the brief language.',
    'Never invent product claims, prices, offers, statistics, dates, or links that are not in the brief. Never mention that this text was generated.',
    'Do not use em dashes or en dashes anywhere; use commas, periods, or parentheses.',
    'rationale: in 1 to 3 sentences, say which evidence posts and which measured signal (platform, timing, or pattern) shaped this draft. Refer to evidence posts by their label (for example "Evidence 1"), never by id.',
    'evidenceIds: only ids present in the brief.',
  ].join(' ');
}

export async function loadDraftBrandContext(workspaceId: string, productId: string): Promise<DraftBrandContext> {
  const snapshot = await adminDb.doc(`workspaces/${workspaceId}/products/${productId}`).get();
  if (!snapshot.exists) throw new Error('NOT_FOUND');
  const data = snapshot.data() || {};
  return {
    name: String(data.name || 'Untitled brand'),
    description: typeof data.description === 'string' ? data.description.slice(0, 1500) : '',
    url: typeof data.url === 'string' ? data.url : '',
    voice: data.brandVoice && typeof data.brandVoice === 'object' ? data.brandVoice as Record<string, unknown> : null,
  };
}

export async function loadDraftSourcePost(workspaceId: string, productId: string, socialPostId: string, insights: ProductInsights): Promise<DraftEvidencePost | null> {
  const fromInsights = insights.rollup.measuredPosts.find((row) => row.id === socialPostId)
    || insights.rollup.topContent.find((row) => row.id === socialPostId);
  if (fromInsights) return toEvidence(fromInsights);
  const snapshot = await adminDb.doc(`workspaces/${workspaceId}/socialPosts/${socialPostId}`).get();
  if (!snapshot.exists || snapshot.data()?.productId !== productId) return null;
  const data = snapshot.data() || {};
  const metrics = (data.latestMetrics || {}) as Record<string, unknown>;
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const engagements = ['likes', 'comments', 'shares', 'saves'].map((key) => number(metrics[key])).filter((value): value is number => value !== null);
  const views = number(metrics.views);
  const engagementTotal = engagements.length ? engagements.reduce((sum, value) => sum + value, 0) : null;
  return {
    id: snapshot.id,
    platform: String(data.platform || 'unknown'),
    content: typeof data.content === 'string' ? data.content.slice(0, 600) : null,
    publishedAt: typeof data.publishedAt === 'string' ? data.publishedAt : null,
    views,
    engagements: engagementTotal,
    engagementRate: engagementTotal !== null && views !== null && views > 0 ? engagementTotal / views : null,
    objectiveValue: views,
    fingerprint: data.fingerprint || null,
  };
}

export async function generateIntelligenceDraft(input: {
  workspaceId: string;
  uid: string;
  productId: string;
  brief: DraftBrief;
}): Promise<{
  postId: string;
  platform: SocialChannel;
  content: string;
  caption: string;
  hashtags: string[];
  hook: string | null;
  rationale: string;
  evidenceIds: string[];
  model: string;
}> {
  const generated = await generateStructured({
    schema: draftOutputSchema,
    system: draftSystemPrompt(input.brief.platform),
    untrustedContent: JSON.stringify(input.brief),
    modelClass: 'fast',
  });
  const validIds = new Set(input.brief.evidence.map((post) => post.id));
  const evidenceIds = generated.value.evidenceIds.filter((id) => validIds.has(id));
  const caption = sanitizeGeneratedCopy(generated.value.caption);
  const content = composeDraftContent(caption, generated.value.hashtags);
  const rationale = sanitizeGeneratedCopy(generated.value.rationale);
  const now = new Date().toISOString();
  const artifactId = randomUUID();
  const postRef = adminDb.collection(`workspaces/${input.workspaceId}/posts`).doc();
  const batch = adminDb.batch();
  batch.set(postRef, {
    content,
    channel: input.brief.platform,
    targetChannels: [input.brief.platform],
    status: 'draft',
    scheduledAt: null,
    mediaUrls: [],
    productId: input.productId,
    workspaceId: input.workspaceId,
    createdBy: input.uid,
    createdAt: now,
    updatedAt: now,
    intelligence: {
      kind: 'generated_draft',
      version: DRAFT_GENERATION_VERSION,
      source: input.brief.source.type,
      sourceId: input.brief.source.type === 'post' ? input.brief.source.postId : null,
      rationale,
      evidenceIds,
      hook: generated.value.hook ? sanitizeGeneratedCopy(generated.value.hook) : null,
      model: generated.model,
      artifactId,
      createdAt: now,
    },
  });
  batch.set(adminDb.doc(`workspaces/${input.workspaceId}/aiArtifacts/${artifactId}`), {
    workspaceId: input.workspaceId,
    kind: 'draft_response',
    postId: postRef.id,
    response: generated.value,
    brief: JSON.parse(JSON.stringify(input.brief)),
    model: generated.model,
    repaired: generated.repaired,
    inputTokens: generated.inputTokens,
    outputTokens: generated.outputTokens,
    expiresAt: new Date(Date.parse(now) + 30 * 24 * 60 * 60_000),
    createdAt: now,
  });
  await batch.commit();
  logger.info('intelligence draft created', {
    event: 'intelligence.draft_created',
    workspaceId: input.workspaceId,
    postId: postRef.id,
    platform: input.brief.platform,
    source: input.brief.source.type,
    latencyMs: generated.latencyMs,
  });
  return {
    postId: postRef.id,
    platform: input.brief.platform,
    content,
    caption,
    hashtags: generated.value.hashtags,
    hook: generated.value.hook,
    rationale,
    evidenceIds,
    model: generated.model,
  };
}
