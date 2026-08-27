import { createHash } from 'node:crypto';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { socialChannels, type SocialChannel } from '@/lib/schemas';
import { generateStructured } from './ai-gateway';
import { AUDIENCE_FIT_WEIGHTS, calculateAudienceFit, type AudienceFitAssessment } from './audience-fit';
import { hourBucket, historicalFitAssessment, timingFitAssessment } from './historical-fit';

export const audienceFitRequestSchema = z.object({
  productId: z.string().min(1).max(128),
  platform: z.enum(socialChannels),
  content: z.string().min(1).max(30_000),
  sourcePostId: z.string().max(200).optional(),
  scheduledAt: z.string().min(1).max(40).refine((value) => Number.isFinite(Date.parse(value))).optional(),
});

export type AudienceFitRequest = z.infer<typeof audienceFitRequestSchema>;

export function audienceFitJobId(workspaceId: string, request: AudienceFitRequest): string {
  return createHash('sha256').update([
    workspaceId,
    request.productId,
    request.platform,
    request.content,
    request.scheduledAt || '',
    'audience-fit-v1',
  ].join('\0')).digest('base64url').slice(0, 40);
}

const componentAssessmentSchema = z.object({
  components: z.record(z.string(), z.object({
    score: z.number().min(0).max(100),
    confidence: z.number().min(0).max(1),
    evidence: z.string().min(1).max(400),
    recommendation: z.string().min(1).max(400),
  })),
  suggestedCopy: z.object({
    caption: z.string().min(1).max(8_000).nullable(),
    hook: z.string().min(1).max(400).nullable(),
  }).optional(),
});

export async function createAudienceFitJob(input: {
  workspaceId: string;
  uid: string;
  request: AudienceFitRequest;
}): Promise<{ jobId: string; status: string; result?: unknown }> {
  const idempotencyKey = audienceFitJobId(input.workspaceId, input.request);
  const jobId = idempotencyKey;
  const ref = adminDb.doc(`workspaces/${input.workspaceId}/intelligenceJobs/${jobId}`);
  const existing = await ref.get();
  if (existing.exists && existing.data()?.status === 'complete') {
    return { jobId, status: 'complete', result: existing.data()?.result };
  }
  const now = new Date().toISOString();
  await ref.set({
    jobId,
    type: 'audience_fit',
    status: 'queued',
    workspaceId: input.workspaceId,
    productId: input.request.productId,
    requestedBy: input.uid,
    request: input.request,
    idempotencyKey,
    attempts: 0,
    nextAttemptAt: now,
    createdAt: existing.data()?.createdAt || now,
    updatedAt: now,
  }, { merge: true });
  return { jobId, status: 'queued' };
}

export async function executeAudienceFitJob(input: {
  workspaceId: string;
  jobId: string;
  request: AudienceFitRequest;
}): Promise<Record<string, unknown>> {
  const { workspaceId, request } = input;
  const [profileSnapshot, postsSnapshot] = await Promise.all([
    adminDb.doc(`workspaces/${workspaceId}/products/${request.productId}/intelligence/profile`).get(),
    adminDb.collection(`workspaces/${workspaceId}/socialPosts`)
      .where('productId', '==', request.productId)
      .where('platform', '==', request.platform)
      .limit(1000)
      .get(),
  ]);
  const profile = profileSnapshot.data() || {};
  const posts = postsSnapshot.docs.map((doc) => doc.data());
  const components = AUDIENCE_FIT_WEIGHTS[request.platform].map((weight) => weight.component);
  const semanticComponents = components.filter((component) => !['history', 'timing'].includes(component));
  const generated = await generateStructured({
    schema: componentAssessmentSchema,
    system: [
      `Assess content for ${request.platform}. Return these exact component keys: ${semanticComponents.join(', ')}.`,
      'Score only observable content fit against the supplied brand audience profile.',
      'Never infer performance metrics, protected traits, or unsupported platform data.',
      'Each score requires concise evidence. Do not calculate the final weighted score.',
      'If you suggest revised wording, return it in suggestedCopy and never claim it was applied.',
    ].join(' '),
    untrustedContent: JSON.stringify({ profile, draft: request.content }),
  });
  const assessments: AudienceFitAssessment[] = components.map((component) => {
    if (component === 'history') {
      return historicalFitAssessment(posts, typeof profile.objective === 'string' ? profile.objective : undefined);
    }
    if (component === 'timing') {
      return timingFitAssessment({
        posts,
        timeZone: typeof profile.primaryTimezone === 'string' ? profile.primaryTimezone : 'UTC',
        scheduledAt: request.scheduledAt,
        objective: typeof profile.objective === 'string' ? profile.objective : undefined,
      });
    }
    const assessment = generated.value.components[component];
    if (!assessment) return { component, score: null, confidence: 0, evidence: [] };
    return {
      component,
      score: assessment.score,
      confidence: assessment.confidence,
      evidence: [assessment.evidence],
      recommendation: assessment.recommendation,
    };
  });
  const relevantPosts = postsSnapshot.size;
  const timeZone = typeof profile.primaryTimezone === 'string' ? profile.primaryTimezone : 'UTC';
  const targetBucket = request.scheduledAt ? hourBucket(request.scheduledAt, timeZone) : null;
  const timingSegmentSampleSize = targetBucket
    ? posts.filter((post) => typeof post.publishedAt === 'string' && hourBucket(post.publishedAt, timeZone) === targetBucket).length
    : 0;
  const fit = calculateAudienceFit({
    platform: request.platform as SocialChannel,
    assessments,
    historicalSampleSize: relevantPosts,
    timingOverallSampleSize: relevantPosts,
    timingSegmentSampleSize,
  });
  const suggestedCopy = generated.value.suggestedCopy?.caption
    && generated.value.suggestedCopy.caption !== request.content
    ? generated.value.suggestedCopy
    : null;
  return {
    analysisVersion: 'audience-fit-v1',
    productId: request.productId,
    platform: request.platform,
    fit,
    assessments,
    suggestedCopy,
    source: { model: generated.model, kind: 'recommended' },
    sampleSize: relevantPosts,
    calculatedAt: new Date().toISOString(),
  };
}
