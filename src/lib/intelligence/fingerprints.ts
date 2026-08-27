import { createHash, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { generateStructured } from './ai-gateway';
import {
  contentFingerprintSchema,
  type ContentFingerprint,
  type FingerprintRequest,
} from './fingerprint-schemas';
import { executeAudienceFitJob, type AudienceFitRequest } from './audience-fit-analysis';

export const FINGERPRINT_ANALYSIS_VERSION = 'fingerprint-v1';
const MAX_ATTEMPTS = 5;

export function fingerprintCacheKey(workspaceId: string, request: FingerprintRequest): string {
  return createHash('sha256').update([
    workspaceId,
    request.assetSha256 || request.storageUri || '',
    createHash('sha256').update(request.content).digest('hex'),
    request.kind,
    FINGERPRINT_ANALYSIS_VERSION,
  ].join('\0')).digest('base64url');
}

export async function getCachedFingerprint(
  workspaceId: string,
  request: FingerprintRequest,
): Promise<{ id: string; fingerprint: ContentFingerprint } | null> {
  const id = fingerprintCacheKey(workspaceId, request);
  const snapshot = await adminDb.doc(`workspaces/${workspaceId}/contentFingerprints/${id}`).get();
  if (!snapshot.exists) return null;
  const parsed = contentFingerprintSchema.safeParse(snapshot.data()?.fingerprint);
  return parsed.success ? { id, fingerprint: parsed.data } : null;
}

/**
 * Compact projection stored on the canonical social post so learnings,
 * strategist evidence, and the Content tab can read patterns without loading
 * the full fingerprint document.
 */
export function fingerprintStorageSummary(fingerprint: ContentFingerprint): Record<string, unknown> {
  const hook = 'hook' in fingerprint ? fingerprint.hook : null;
  const openingStyle = 'openingStyle' in fingerprint ? fingerprint.openingStyle : null;
  const hashtags = fingerprint.kind === 'caption' ? fingerprint.hashtags.slice(0, 15) : [];
  return {
    kind: fingerprint.kind,
    pillar: fingerprint.pillar,
    hook,
    openingStyle,
    topics: fingerprint.topics.slice(0, 8),
    keywords: fingerprint.keywords.slice(0, 10),
    cta: fingerprint.cta,
    sentiment: fingerprint.sentiment,
    structure: fingerprint.structure.slice(0, 6),
    hashtags,
    productPresence: fingerprint.productPresence,
    humanPresence: fingerprint.humanPresence,
    confidence: fingerprint.confidence,
  };
}

export async function applyFingerprintToSocialPost(input: {
  workspaceId: string;
  socialPostId: string;
  cacheId: string;
  fingerprint: ContentFingerprint;
  nowIso?: string;
}): Promise<void> {
  const now = input.nowIso || new Date().toISOString();
  await adminDb.doc(`workspaces/${input.workspaceId}/socialPosts/${input.socialPostId}`).set({
    fingerprint: fingerprintStorageSummary(input.fingerprint),
    fingerprintId: input.cacheId,
    fingerprintVersion: FINGERPRINT_ANALYSIS_VERSION,
    fingerprintedAt: now,
    fingerprintQueuedAt: FieldValue.delete(),
    updatedAt: now,
  }, { merge: true });
}

export async function createFingerprintJob(input: {
  workspaceId: string;
  uid: string;
  request: FingerprintRequest;
  /** Canonical social post to stamp with the summary once analysis completes. */
  applyToSocialPostId?: string;
  /** System jobs come from the worker backfill and are never user-metered. */
  system?: boolean;
}): Promise<{ jobId: string; cached: boolean; fingerprint?: ContentFingerprint }> {
  const cached = await getCachedFingerprint(input.workspaceId, input.request);
  if (cached) {
    if (input.applyToSocialPostId) {
      await applyFingerprintToSocialPost({
        workspaceId: input.workspaceId,
        socialPostId: input.applyToSocialPostId,
        cacheId: cached.id,
        fingerprint: cached.fingerprint,
      });
    }
    return { jobId: `cache:${cached.id}`, cached: true, fingerprint: cached.fingerprint };
  }
  const key = fingerprintCacheKey(input.workspaceId, input.request);
  const jobId = createHash('sha256')
    .update(`${input.workspaceId}\0${input.request.productId}\0${key}`)
    .digest('base64url')
    .slice(0, 40);
  const ref = adminDb.doc(`workspaces/${input.workspaceId}/intelligenceJobs/${jobId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists || ['failed', 'dead_letter'].includes(String(snapshot.data()?.status))) {
    const now = new Date().toISOString();
    await ref.set({
      jobId,
      type: 'content_fingerprint',
      status: 'queued',
      workspaceId: input.workspaceId,
      productId: input.request.productId,
      requestedBy: input.uid,
      request: input.request,
      idempotencyKey: key,
      ...(input.applyToSocialPostId ? { applyToSocialPostId: input.applyToSocialPostId } : {}),
      system: input.system === true,
      attempts: 0,
      nextAttemptAt: now,
      createdAt: snapshot.data()?.createdAt || now,
      updatedAt: now,
    }, { merge: true });
  } else if (input.applyToSocialPostId && snapshot.data()?.applyToSocialPostId !== input.applyToSocialPostId) {
    await ref.set({ applyToSocialPostId: input.applyToSocialPostId, updatedAt: new Date().toISOString() }, { merge: true });
  }
  return { jobId, cached: false };
}

function systemPrompt(kind: FingerprintRequest['kind']): string {
  return [
    `Classify this ${kind} content into the supplied content-fingerprint schema.`,
    'Describe only observable content. Do not identify people or infer protected or sensitive traits.',
    'Do not calculate an Audience Fit score and do not invent performance metrics.',
    'Evidence must be short and grounded in the supplied content.',
  ].join(' ');
}

async function executeFingerprintJob(
  workspaceId: string,
  jobId: string,
  request: FingerprintRequest,
): Promise<{ cacheId: string; fingerprint: ContentFingerprint }> {
  const startedAt = Date.now();
  const cacheId = fingerprintCacheKey(workspaceId, request);
  const existing = await getCachedFingerprint(workspaceId, request);
  if (existing) {
    await adminDb.doc(`workspaces/${workspaceId}/intelligenceJobs/${jobId}`).set({
      status: 'complete',
      resultRef: `contentFingerprints/${existing.id}`,
      cacheHit: true,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return { cacheId: existing.id, fingerprint: existing.fingerprint };
  }

  const generated = await generateStructured({
    schema: contentFingerprintSchema,
    system: systemPrompt(request.kind),
    untrustedContent: request.content,
    storageUri: request.storageUri,
    mimeType: request.mimeType,
  });
  if (generated.value.kind !== request.kind) throw new Error('AI_FINGERPRINT_KIND_MISMATCH');
  const now = new Date().toISOString();
  const fingerprintRef = adminDb.doc(`workspaces/${workspaceId}/contentFingerprints/${cacheId}`);
  const artifactRef = adminDb.doc(`workspaces/${workspaceId}/aiArtifacts/${randomUUID()}`);
  const jobRef = adminDb.doc(`workspaces/${workspaceId}/intelligenceJobs/${jobId}`);
  const batch = adminDb.batch();
  batch.set(fingerprintRef, {
    id: cacheId,
    workspaceId,
    productId: request.productId,
    sourcePostId: request.sourcePostId || null,
    sourceHash: request.assetSha256 || null,
    captionHash: createHash('sha256').update(request.content).digest('hex'),
    analysisVersion: FINGERPRINT_ANALYSIS_VERSION,
    fingerprint: generated.value,
    model: generated.model,
    createdAt: now,
    updatedAt: now,
  });
  batch.set(artifactRef, {
    workspaceId,
    productId: request.productId,
    kind: 'fingerprint_response',
    fingerprintId: cacheId,
    response: generated.value,
    model: generated.model,
    repaired: generated.repaired,
    inputTokens: generated.inputTokens,
    outputTokens: generated.outputTokens,
    expiresAt: new Date(Date.parse(now) + 30 * 24 * 60 * 60_000),
    createdAt: now,
  });
  batch.set(jobRef, {
    status: 'complete',
    resultRef: `contentFingerprints/${cacheId}`,
    cacheHit: false,
    latencyMs: generated.latencyMs,
    completedAt: now,
    leaseId: FieldValue.delete(),
    leaseUntil: FieldValue.delete(),
    updatedAt: now,
  }, { merge: true });
  await batch.commit();
  logger.info('content fingerprint completed', {
    event: 'intelligence.fingerprint_complete',
    workspaceId,
    jobId,
    latencyMs: Date.now() - startedAt,
    cacheHit: false,
  });
  return { cacheId, fingerprint: generated.value };
}

export async function processIntelligenceJobs(
  workspaceId: string,
  nowIso = new Date().toISOString(),
): Promise<{ processed: number; failed: number }> {
  const snapshots = await adminDb.collection(`workspaces/${workspaceId}/intelligenceJobs`)
    .where('status', '==', 'queued')
    .limit(10)
    .get();
  let processed = 0;
  let failed = 0;
  for (const doc of snapshots.docs) {
    const data = doc.data();
    if (data.nextAttemptAt && String(data.nextAttemptAt) > nowIso) continue;
    const leaseId = randomUUID();
    const claimed = await adminDb.runTransaction(async (tx) => {
      const current = await tx.get(doc.ref);
      if (!current.exists || current.data()?.status !== 'queued') return false;
      if (current.data()?.leaseUntil && String(current.data()?.leaseUntil) > nowIso) return false;
      tx.set(doc.ref, {
        status: 'running',
        leaseId,
        leaseUntil: new Date(Date.parse(nowIso) + 4 * 60_000).toISOString(),
        attempts: (Number(current.data()?.attempts) || 0) + 1,
        startedAt: nowIso,
        updatedAt: nowIso,
      }, { merge: true });
      return true;
    });
    if (!claimed) continue;
    try {
      if (data.type === 'content_fingerprint') {
        const result = await executeFingerprintJob(workspaceId, doc.id, data.request as FingerprintRequest);
        const socialPostId = typeof data.applyToSocialPostId === 'string' ? data.applyToSocialPostId : null;
        if (socialPostId) {
          await applyFingerprintToSocialPost({
            workspaceId,
            socialPostId,
            cacheId: result.cacheId,
            fingerprint: result.fingerprint,
          });
        }
      } else if (data.type === 'audience_fit') {
        const result = await executeAudienceFitJob({ workspaceId, jobId: doc.id, request: data.request as AudienceFitRequest });
        const completedAt = new Date().toISOString();
        await doc.ref.set({
          status: 'complete',
          result,
          completedAt,
          leaseId: FieldValue.delete(),
          leaseUntil: FieldValue.delete(),
          updatedAt: completedAt,
        }, { merge: true });
      } else {
        throw new Error('UNKNOWN_INTELLIGENCE_JOB');
      }
      processed += 1;
    } catch (error) {
      failed += 1;
      const attempts = (Number(data.attempts) || 0) + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      const delayMs = Math.min(6 * 60 * 60_000, 30_000 * (2 ** Math.max(0, attempts - 1)));
      await doc.ref.set({
        status: dead ? 'dead_letter' : 'queued',
        lastErrorCode: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
        nextAttemptAt: dead ? null : new Date(Date.parse(nowIso) + delayMs).toISOString(),
        leaseId: FieldValue.delete(),
        leaseUntil: FieldValue.delete(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
  }
  return { processed, failed };
}
