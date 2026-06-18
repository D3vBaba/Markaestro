import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import type { UnifiedInsights } from '@/lib/social/types';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'analytics.read');
    const { productId } = await params;

    // Load product name
    const productSnap = await adminDb.doc(`workspaces/${ctx.workspaceId}/products/${productId}`).get();
    if (!productSnap.exists) throw new Error('NOT_FOUND');
    const productName = (productSnap.data()?.name as string) || 'Unknown Product';

    const insights: UnifiedInsights = {
      productId,
      productName,
      facebook: { platform: 'facebook', connected: false, error: 'Provider insights are disabled for publishing-only mode' },
      instagram: { platform: 'instagram', connected: false, error: 'Provider insights are disabled for publishing-only mode' },
      tiktok: { platform: 'tiktok', connected: false, error: 'Provider insights are disabled for publishing-only mode' },
      fetchedAt: new Date().toISOString(),
    };

    return apiOk(insights);
  } catch (error) {
    return apiError(error);
  }
}
