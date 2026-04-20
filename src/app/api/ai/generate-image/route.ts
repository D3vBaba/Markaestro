import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { generateImageSchema } from '@/lib/schemas';
import { generateAndUploadImage, type ImageGenRequest } from '@/lib/ai/image-generator';
import { interpretSceneIntent } from '@/lib/ai/image-scene-interpreter';
import { researchForPipeline, buildImageResearchContext } from '@/lib/ai/pipeline-researcher';
import { checkAndIncrementUsage, refundUsage } from '@/lib/usage';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Cap parallel provider calls per request to avoid one user exhausting the
// Cloud Run per-instance egress slots or hitting provider rate limits in a
// thundering-herd.
const MAX_PARALLEL_IMAGES = 4;

async function mapInBatches<T, U>(
  items: T[],
  batchSize: number,
  fn: (item: T, index: number) => Promise<U>,
): Promise<PromiseSettledResult<U>[]> {
  const results: PromiseSettledResult<U>[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map((item, j) => fn(item, i + j)));
    results.push(...settled);
  }
  return results;
}

export async function POST(req: Request) {
  let charged = 0;
  let ctxForRefund: { uid: string; workspaceId: string } | null = null;
  try {
    const ctx = await requireContext(req);
    ctxForRefund = { uid: ctx.uid, workspaceId: ctx.workspaceId };
    requirePermission(ctx, 'ai.use');

    // Per-user AI rate limit — images are expensive, so tighter than text.
    const rl = await applyRateLimit(req, RATE_LIMITS.ai, {
      key: `ai-image:${ctx.uid}:${ctx.workspaceId}`,
    });

    const body = await req.json();
    const input = generateImageSchema.parse(body);

    // Charge one quota unit per requested image up-front, and refund any
    // images that ultimately fail to generate in the `finally` below.
    for (let i = 0; i < input.count; i++) {
      const quota = await checkAndIncrementUsage(ctx.uid, 'aiGenerations', ctx.workspaceId);
      if (!quota.allowed) throw new Error('QUOTA_EXCEEDED');
      charged += 1;
    }

    // Load full product data if productId provided
    let brandIdentity: ImageGenRequest['brandIdentity'];
    let brandVoice: ImageGenRequest['brandVoice'];
    let productName: string | undefined;
    let productDescription: string | undefined;
    let productCategories: string[] | undefined;
    let productUrl: string | undefined;
    let logoUrl: string | undefined;
    let researchContext: ImageGenRequest['researchContext'];

    if (input.productId) {
      const productRef = adminDb.doc(`workspaces/${ctx.workspaceId}/products/${input.productId}`);
      const productSnap = await productRef.get();
      if (productSnap.exists) {
        const product = productSnap.data()!;
        productName = product.name;
        productDescription = product.description || product.tagline || '';
        productCategories = product.categories || (product.category ? [product.category] : undefined);
        productUrl = product.url || product.website || '';
        brandIdentity = product.brandIdentity;
        brandVoice = product.brandVoice;

        if (input.includeLogo && product.brandIdentity?.logoUrl) {
          logoUrl = product.brandIdentity.logoUrl;
        }

        // Fetch research context for visual grounding (cache hit = instant)
        try {
          const brief = await researchForPipeline({
            productId: input.productId,
            productName: product.name,
            productDescription: product.description || product.tagline || '',
            productUrl: product.url || product.website || undefined,
            productCategories: product.categories || (product.category ? [product.category] : []),
            brandVoice: product.brandVoice || undefined,
          });
          researchContext = buildImageResearchContext(brief);
        } catch {
          // Non-fatal — generate without research context
        }
      }
    }

    // Interpret the scene intent ONCE for the whole batch — every image in
    // a single request is for the same product and post text, so they should
    // share an intent. Saves N-1 LLM calls and prevents the parallel calls
    // below from racing the in-memory cache.
    const sceneIntent = input.promptMode === 'custom_override'
      ? undefined
      : (await interpretSceneIntent({
          productName,
          productDescription,
          productCategories,
          postText: input.prompt,
          channel: input.channel,
          hasScreenshots: !!input.screenUrls?.length,
        })) || undefined;

    const genRequest = {
      prompt: input.prompt,
      promptMode: input.promptMode,
      customPrompt: input.customPrompt,
      brandIdentity,
      brandVoice,
      productName,
      productDescription,
      productCategories,
      productUrl,
      channel: input.channel,
      subtype: input.subtype,
      style: input.style,
      aspectRatio: input.aspectRatio,
      provider: input.provider,
      screenUrls: input.screenUrls,
      logoUrl,
      researchContext,
      sceneIntent,
    } as const;

    // Run N generations in bounded parallelism. If some fail, return the
    // successful ones (at least one must succeed or the whole request
    // fails — and we refund the failures below).
    const settled = await mapInBatches(
      Array.from({ length: input.count }, (_, idx) => idx),
      MAX_PARALLEL_IMAGES,
      () => generateAndUploadImage(genRequest, ctx.workspaceId),
    );

    const successes = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    const failures = settled.flatMap((s) => (s.status === 'rejected' ? [s.reason] : []));

    if (successes.length === 0) {
      const firstError = failures[0];
      throw firstError instanceof Error ? firstError : new Error('Image generation failed');
    }

    // Refund quota for failed images only — we already paid for successes.
    const toRefund = charged - successes.length;
    if (toRefund > 0) {
      await refundUsage(ctx.uid, 'aiGenerations', toRefund, ctx.workspaceId).catch(() => {});
      charged = successes.length; // prevent double refund in the catch block
    } else {
      charged = 0;
    }

    const imageUrls = successes.map((r) => r.imageUrl);
    const resp = apiOk({
      imageUrl: imageUrls[0], // backwards-compat: primary image
      imageUrls,
      provider: successes[0].provider,
      revisedPrompt: successes[0].revisedPrompt,
      requested: input.count,
      generated: imageUrls.length,
      partial: imageUrls.length < input.count,
    });
    for (const [k, v] of Object.entries(rl.headers)) resp.headers.set(k, v);
    return resp;
  } catch (error) {
    // Refund any units that were charged but never consumed.
    if (charged > 0 && ctxForRefund) {
      await refundUsage(ctxForRefund.uid, 'aiGenerations', charged, ctxForRefund.workspaceId).catch(() => {});
    }
    console.error('[generate-image] Error:', error instanceof Error ? error.message : error);
    return apiError(error);
  }
}
