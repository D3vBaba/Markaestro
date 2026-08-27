import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { generateStructured } from './ai-gateway';
import type { ProductInsights } from './insights';
import { sanitizeGeneratedCopy } from './drafts';

/**
 * "Why it worked": a short, grounded explanation of one measured post relative
 * to the rest of the brand's history. Generated once per post and cached on the
 * post document; re-generated only when the fingerprint or the prompt version
 * changes, so cost is bounded by the number of posts, not page views.
 */
export const EXPLANATION_VERSION = 'why-v2';

export const explainRequestSchema = z.object({
  productId: z.string().min(1).max(128),
  socialPostId: z.string().min(1).max(200),
  locale: z.string().max(12).optional(),
});

export const explanationSchema = z.object({
  summary: z.string().min(1).max(400),
  factors: z.array(z.object({
    label: z.string().min(1).max(60),
    detail: z.string().min(1).max(220),
  })).max(4),
  tryNext: z.string().max(240).nullable(),
});

export type PostExplanation = z.infer<typeof explanationSchema> & {
  version: string;
  fingerprintId: string | null;
  model: string;
  createdAt: string;
};

export type ExplanationContext = {
  version: string;
  language: string;
  objective: string;
  metric: string;
  post: {
    id: string;
    platform: string;
    publishedAt: string | null;
    /** Publish time rendered in the brand's timezone, e.g. "Sunday 10:58 AM (America/Los_Angeles)". */
    publishedAtLocal: string | null;
    caption: string | null;
    metrics: { views: number | null; engagements: number | null; engagementRate: number | null; objectiveValue: number | null };
    fingerprint: unknown;
  };
  account: {
    platformAverage: { views: number | null; engagements: number | null; engagementRate: number | null; measuredPosts: number } | null;
    rankAmongMeasured: { position: number; of: number } | null;
    bestWindow: { weekday: string; hour: string; timeZone: string } | null;
  };
};

const round1 = (value: number | null | undefined): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null
);
const round4 = (value: number | null | undefined): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10_000) / 10_000 : null
);

function localPublishTime(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const formatted = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(date);
    return `${formatted} (${timeZone})`;
  } catch {
    return null;
  }
}

export function buildExplanationContext(input: {
  postId: string;
  insights: ProductInsights;
  locale?: string;
}): ExplanationContext | null {
  const rows = input.insights.rollup.measuredPosts;
  const row = rows.find((item) => item.id === input.postId) || input.insights.rollup.topContent.find((item) => item.id === input.postId);
  if (!row) return null;
  const channel = input.insights.rollup.channels.find((item) => item.platform === row.platform);
  const ranked = [...rows].sort((a, b) => (b.objectiveValue ?? b.views ?? Number.NEGATIVE_INFINITY) - (a.objectiveValue ?? a.views ?? Number.NEGATIVE_INFINITY));
  const position = ranked.findIndex((item) => item.id === row.id);
  const best = input.insights.timing.windows[0];
  return {
    version: EXPLANATION_VERSION,
    language: input.locale || 'en',
    objective: input.insights.objective.objective,
    metric: input.insights.objective.metric,
    post: {
      id: row.id,
      platform: row.platform,
      publishedAt: row.publishedAt,
      publishedAtLocal: localPublishTime(row.publishedAt, input.insights.timing.timeZone),
      caption: row.content ? row.content.slice(0, 1500) : null,
      metrics: {
        views: row.views,
        engagements: row.engagements,
        engagementRate: round4(row.engagementRate),
        objectiveValue: row.objectiveValue,
      },
      fingerprint: row.fingerprint,
    },
    account: {
      platformAverage: channel
        ? {
          views: round1(channel.avgViews),
          engagements: round1(channel.avgEngagements),
          engagementRate: round4(channel.engagementRate),
          measuredPosts: Math.max(channel.measuredViews ?? 0, channel.measuredEngagements ?? 0),
        }
        : null,
      rankAmongMeasured: position >= 0 ? { position: position + 1, of: ranked.length } : null,
      bestWindow: best ? { weekday: best.weekday, hour: best.hour, timeZone: input.insights.timing.timeZone } : null,
    },
  };
}

export const EXPLANATION_SYSTEM_PROMPT = [
  'Explain, for a brand owner, why this one social post performed the way it did compared with the rest of the same account.',
  'Use only the supplied numbers, fingerprint, and account comparison. Every factor must point at something in the context (a metric, the caption, the fingerprint, the timing window, or the platform average).',
  'Describe associations, never causes. If the post is below the platform average, say so plainly and explain what differs.',
  'Write in the language of the caption; if there is no caption, use the context language. Keep it plain and specific. Use the local publish time (publishedAtLocal) when you talk about timing, and round numbers the way a person would say them.',
  'Do not use em dashes or en dashes. Do not invent metrics that are null.',
  'tryNext: one concrete, testable suggestion the brand could try on its next post, or null.',
].join(' ');

function cachedExplanation(value: unknown): PostExplanation | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const parsed = explanationSchema.safeParse({ summary: raw.summary, factors: raw.factors, tryNext: raw.tryNext ?? null });
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    version: String(raw.version || ''),
    fingerprintId: typeof raw.fingerprintId === 'string' ? raw.fingerprintId : null,
    model: String(raw.model || ''),
    createdAt: String(raw.createdAt || ''),
  };
}

export async function explainPostPerformance(input: {
  workspaceId: string;
  uid: string;
  productId: string;
  socialPostId: string;
  insights: ProductInsights;
  locale?: string;
  /** Invoked only when a model call is actually needed (cache miss). */
  beforeGenerate: () => Promise<void>;
}): Promise<{ explanation: PostExplanation; cached: boolean }> {
  const ref = adminDb.doc(`workspaces/${input.workspaceId}/socialPosts/${input.socialPostId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.productId !== input.productId) throw new Error('NOT_FOUND');
  const data = snapshot.data() || {};
  const fingerprintId = typeof data.fingerprintId === 'string' ? data.fingerprintId : null;
  const existing = cachedExplanation(data.whyItWorked);
  if (existing && existing.version === EXPLANATION_VERSION && existing.fingerprintId === fingerprintId) {
    return { explanation: existing, cached: true };
  }
  const context = buildExplanationContext({ postId: input.socialPostId, insights: input.insights, locale: input.locale });
  if (!context) throw new Error('VALIDATION_POST_NOT_MEASURED');
  await input.beforeGenerate();
  const generated = await generateStructured({
    schema: explanationSchema,
    system: EXPLANATION_SYSTEM_PROMPT,
    untrustedContent: JSON.stringify(context),
    modelClass: 'fast',
  });
  const now = new Date().toISOString();
  const explanation: PostExplanation = {
    summary: sanitizeGeneratedCopy(generated.value.summary),
    factors: generated.value.factors.map((factor) => ({
      label: sanitizeGeneratedCopy(factor.label),
      detail: sanitizeGeneratedCopy(factor.detail),
    })),
    tryNext: generated.value.tryNext ? sanitizeGeneratedCopy(generated.value.tryNext) : null,
    version: EXPLANATION_VERSION,
    fingerprintId,
    model: generated.model,
    createdAt: now,
  };
  await ref.set({ whyItWorked: explanation, updatedAt: now }, { merge: true });
  logger.info('post explanation generated', {
    event: 'intelligence.explanation_generated',
    workspaceId: input.workspaceId,
    socialPostId: input.socialPostId,
    latencyMs: generated.latencyMs,
  });
  return { explanation, cached: false };
}
