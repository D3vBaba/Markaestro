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
import type { WorkspaceRole } from '@/lib/schemas';

const createSchema = z.object({
  productId: z.string().min(1).max(128),
  destination: z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
  label: z.string().min(1).max(160),
  campaignId: z.string().max(128).optional(),
  socialPostId: z.string().max(128).optional(),
});

function appOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(req.url).origin;
}

/** Counters live on the link document (see recordTrackedLinkClick): no click scan. */
function linkRow(data: Record<string, unknown>, origin: string) {
  const code = String(data.code || '');
  return {
    code,
    label: String(data.label || ''),
    destination: String(data.destination || ''),
    productId: String(data.productId || ''),
    campaignId: typeof data.campaignId === 'string' ? data.campaignId : null,
    socialPostId: typeof data.socialPostId === 'string' ? data.socialPostId : null,
    active: data.active !== false,
    url: `${origin}/r/${code}`,
    clicks: Number(data.clicks) || 0,
    lastClickedAt: typeof data.lastClickedAt === 'string' ? data.lastClickedAt : null,
    attributedConversions: Number(data.attributedConversions) || 0,
    lastConversionAt: typeof data.lastConversionAt === 'string' ? data.lastConversionAt : null,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : null,
  };
}

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
    const productId = new URL(req.url).searchParams.get('productId');
    const collection = adminDb.collection(`workspaces/${ctx.workspaceId}/trackedLinks`);
    const snapshot = await (productId ? collection.where('productId', '==', productId) : collection).limit(200).get();
    const origin = appOrigin(req);
    const links = snapshot.docs
      .map((doc) => linkRow(doc.data(), origin))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    // Anyone installing the server-side conversion snippet is already on this
    // screen, so the credentials it needs are returned alongside the links.
    // The key id names the workspace and is not secret; the signing secret is
    // only returned to a principal that could create conversions anyway.
    return apiOk({ links, ingest: ingestCredentials(ctx) });
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
    return apiCreated({ link: linkRow(data, appOrigin(req)), path: `/r/${code}` });
  } catch (error) {
    return apiError(error);
  }
}
