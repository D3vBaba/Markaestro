import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { generateContent, type ContentRequest } from '@/lib/ai/content-generator';
import { checkAndIncrementUsage, refundUsage } from '@/lib/usage';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { z } from 'zod';

export const runtime = 'nodejs';

const generateSchema = z.object({
  type: z.enum(['social_post', 'ad_copy', 'full_campaign']),
  productName: z.string().trim().max(200).optional(),
  productDescription: z.string().trim().max(2000).optional(),
  targetAudience: z.string().trim().max(500).optional(),
  channel: z.string().trim().max(50).optional(),
  tone: z.string().trim().max(50).optional(),
  additionalContext: z.string().trim().max(2000).optional(),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'ai.use');

    // Per-user AI rate limit, scoped by workspace so shared accounts can't
    // bypass it. Throws 429 if exceeded.
    const rl = await applyRateLimit(req, RATE_LIMITS.ai, {
      key: `ai-generate:${ctx.uid}:${ctx.workspaceId}`,
    });

    const quota = await checkAndIncrementUsage(ctx.uid, 'aiGenerations', ctx.workspaceId);
    if (!quota.allowed) throw new Error('QUOTA_EXCEEDED');

    let committed = false;
    try {
      const body = await req.json();
      const data = generateSchema.parse(body);

      const result = await generateContent(data as ContentRequest);
      committed = true;
      const resp = apiOk({ ...result, generatedBy: 'openai', requestedBy: ctx.uid });
      for (const [k, v] of Object.entries(rl.headers)) resp.headers.set(k, v);
      return resp;
    } finally {
      // Refund the optimistic quota increment on any failure path so users
      // aren't charged against their plan for failed generations.
      if (!committed) {
        await refundUsage(ctx.uid, 'aiGenerations', 1, ctx.workspaceId).catch(() => {});
      }
    }
  } catch (error) {
    return apiError(error);
  }
}
