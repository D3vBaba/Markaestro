import { z } from 'zod';
import { apiCreated, apiError } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { recordConversionEvent, verifyConversionSignature } from '@/lib/intelligence/conversions';

const schema = z.object({
  workspaceId: z.string().max(128).optional(),
  idempotencyId: z.string().min(1).max(200),
  eventType: z.string().min(1).max(80),
  occurredAt: z.iso.datetime(),
  firstClickId: z.string().max(128).optional(),
  lastClickId: z.string().max(128).optional(),
  value: z.number().finite().nonnegative().optional(),
  currency: z.string().length(3).transform((value) => value.toUpperCase()).optional(),
  consent: z.boolean(),
});

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const input = schema.parse(JSON.parse(raw));
    const signed = verifyConversionSignature(raw, req.headers.get('x-markaestro-signature'));
    let workspaceId = input.workspaceId;
    let source: 'browser' | 'server' = 'server';
    if (!signed) {
      const ctx = await requireContext(new Request(req.url, { method: 'POST', headers: req.headers }));
      requirePermission(ctx, 'conversions.manage');
      workspaceId = ctx.workspaceId;
      source = 'browser';
    }
    if (!workspaceId) throw new Error('VALIDATION_WORKSPACE_REQUIRED');
    const result = await recordConversionEvent({ ...input, workspaceId, source });
    return apiCreated(result);
  } catch (error) {
    return apiError(error);
  }
}
