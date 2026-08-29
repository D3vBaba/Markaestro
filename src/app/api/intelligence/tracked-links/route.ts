import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { apiCreated, apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { hasPermission, requirePermission } from '@/lib/rbac';
import {
  createTrackingCode,
  workspaceIngestKeyId,
  workspaceIngestSecret,
} from '@/lib/intelligence/conversions';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';
import { appOrigin, trackedLinkRow, type TrackedLinkRow } from '@/lib/intelligence/tracked-link-rows';
import { executeListQueryPage } from '@/lib/firestore-list-query';
import type { WorkspaceRole } from '@/lib/schemas';

const listQuerySchema = z.object({
  productId: z.string().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(2000).optional(),
  // Retired links are hidden by default; the common view stays clean.
  // Spelled out rather than z.coerce.boolean(), which reads the string
  // "false" as true and would make ?includeInactive=false do the opposite.
  includeInactive: z.enum(['0', '1', 'true', 'false']).optional(),
});

const createSchema = z.object({
  productId: z.string().min(1).max(128),
  destination: z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
  label: z.string().min(1).max(160),
  campaignId: z.string().max(128).optional(),
  socialPostId: z.string().max(128).optional(),
});

/**
 * Credentials for the server-side conversion ingest snippet.
 *
 * `keyId` is public (it is just the workspace id, prefixed) and identifies
 * which workspace's derived secret the server should verify against. The
 * secret itself is withheld from principals that cannot record conversions.
 */
function ingestCredentials(ctx: { workspaceId: string; role: WorkspaceRole }) {
  const keyId = workspaceIngestKeyId(ctx.workspaceId);
  if (!hasPermission(ctx, 'conversions.manage')) return { keyId, secret: null };
  try {
    return { keyId, secret: workspaceIngestSecret(ctx.workspaceId) };
  } catch {
    // The root secret is not configured in this environment. The links list is
    // still useful, so report the snippet as unavailable rather than failing.
    return { keyId, secret: null };
  }
}

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'intelligence.read');
    await requireIntelligenceAccess(ctx, 'learning', 'intelligenceOptimization');
    const query = listQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    // Was a bare .limit(200) with an in-memory sort, which made a heavy user's
    // oldest links unreachable: invisible, and until 3.3 also undeletable.
    const page = await executeListQueryPage<Record<string, unknown>>(
      adminDb.collection(`workspaces/${ctx.workspaceId}/trackedLinks`),
      {
        filters: [
          ...(query.productId ? [{ field: 'productId', op: '==' as const, value: query.productId }] : []),
          ...(query.includeInactive === '1' || query.includeInactive === 'true'
            ? []
            : [{ field: 'active', op: '==' as const, value: true }]),
        ],
        orderByField: 'createdAt',
        orderByDirection: 'desc',
        limit: query.limit,
        cursor: query.cursor,
      },
    );
    const origin = appOrigin(req);
    const links: TrackedLinkRow[] = page.items.map((item) => trackedLinkRow(item, origin));
    // Anyone installing the server-side conversion snippet is already on this
    // screen, so the credentials it needs are returned alongside the links.
    // The key id names the workspace and is not secret; the signing secret is
    // only returned to a principal that could create conversions anyway.
    return apiOk({ links, nextCursor: page.nextCursor, ingest: ingestCredentials(ctx) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'conversions.manage');
    await requireIntelligenceAccess(ctx, 'learning', 'intelligenceOptimization');
    const input = createSchema.parse(await req.json());
    const product = await adminDb.doc(`workspaces/${ctx.workspaceId}/products/${input.productId}`).get();
    if (!product.exists) throw new Error('NOT_FOUND');
    const code = createTrackingCode();
    const now = new Date().toISOString();
    const data = {
      code,
      ...input,
      workspaceId: ctx.workspaceId,
      active: true,
      clicks: 0,
      attributedConversions: 0,
      createdBy: ctx.uid,
      createdAt: now,
      updatedAt: now,
    };
    const batch = adminDb.batch();
    batch.create(adminDb.doc(`trackedLinks/${code}`), data);
    batch.create(adminDb.doc(`workspaces/${ctx.workspaceId}/trackedLinks/${code}`), data);
    await batch.commit();
    return apiCreated({ link: trackedLinkRow(data, appOrigin(req)), path: `/r/${code}` });
  } catch (error) {
    return apiError(error);
  }
}
