import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { socialChannels } from '@/lib/schemas';
import { getManualPublishChannels } from '@/lib/manual-publish-settings';

export const runtime = 'nodejs';

const updatePublishingSettingsSchema = z.object({
  manualPublishChannels: z.array(z.enum(socialChannels)).max(socialChannels.length),
});

/** GET /api/settings/publishing — workspace publishing defaults. */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'dashboard.read');
    const manualPublishChannels = await getManualPublishChannels(ctx.workspaceId);
    return apiOk({ manualPublishChannels });
  } catch (error) {
    return apiError(error);
  }
}

/** PUT /api/settings/publishing — set which channels default to manual posting. */
export async function PUT(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'integrations.manage');

    const { manualPublishChannels } = updatePublishingSettingsSchema.parse(await req.json());
    const deduped = [...new Set(manualPublishChannels)];

    await adminDb.doc(`workspaces/${ctx.workspaceId}`).set({
      manualPublishChannels: deduped,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    return apiOk({ manualPublishChannels: deduped });
  } catch (error) {
    return apiError(error);
  }
}
