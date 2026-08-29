import { z } from 'zod';
import { apiCreated, apiError, ApiValidationError } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { recordConversionEvent, verifyConversionRequest } from '@/lib/intelligence/conversions';

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
    const verification = verifyConversionRequest(
      raw,
      req.headers.get('x-markaestro-signature'),
      req.headers.get('x-markaestro-key-id'),
    );

    let workspaceId: string | undefined;
    let source: 'browser' | 'server' = 'server';

    if (verification.verified && verification.scope === 'workspace') {
      // The workspace comes from the verified key id, never from the body. A
      // body that disagrees is a misconfigured integration, so fail loudly
      // rather than quietly writing into the signer's own workspace.
      workspaceId = verification.workspaceId;
      if (input.workspaceId && input.workspaceId !== workspaceId) {
        throw new ApiValidationError(
          'VALIDATION_WORKSPACE_MISMATCH',
          'The workspace in the request body does not match the workspace this ingest key belongs to.',
          { field: 'workspaceId' },
        );
      }
    } else if (verification.verified) {
      // Legacy global-secret path, accepted for one release. Logged with the
      // claimed workspace so the remaining old snippets can be identified and
      // migrated before this branch is removed.
      workspaceId = input.workspaceId;
      logger.warn('conversion ingest used the legacy global signature', {
        event: 'intelligence.conversion_ingest_legacy_signature',
        workspaceId: workspaceId || 'unknown',
      });
    } else {
      const ctx = await requireContext(new Request(req.url, { method: 'POST', headers: req.headers }));
      requirePermission(ctx, 'conversions.manage');
      workspaceId = ctx.workspaceId;
      source = 'browser';
    }

    if (!workspaceId) throw new Error('VALIDATION_WORKSPACE_REQUIRED');

    // Keyed on the resolved workspace so one noisy customer cannot starve
    // another. Applied after verification, so unsigned junk is rejected first
    // and more cheaply, but before the Firestore reads and writes below.
    await applyRateLimit(req, RATE_LIMITS.ingest, { key: `conversions:${workspaceId}` });

    const result = await recordConversionEvent({ ...input, workspaceId, source });
    return apiCreated(result);
  } catch (error) {
    return apiError(error);
  }
}
