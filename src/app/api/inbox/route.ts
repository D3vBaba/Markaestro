import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { listInboxItems, markInboxRead } from '@/lib/inbox';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const items = await listInboxItems(ctx.workspaceId, ctx.uid, 40);
    const unread = items.filter((item) => !item.readAt).length;
    return apiOk({ items, unread });
  } catch (error) {
    return apiError(error);
  }
}

const patchSchema = z.object({
  id: z.string().min(1).max(128),
  read: z.literal(true),
});

export async function PATCH(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = patchSchema.parse(await req.json());
    await markInboxRead(ctx.workspaceId, body.id, ctx.uid);
    return apiOk({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
