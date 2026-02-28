import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk, apiCreated } from '@/lib/api-response';
import { z } from 'zod';

const eventTypes = [
  'email_sent', 'email_opened', 'email_clicked', 'email_bounced',
  'campaign_started', 'campaign_completed',
  'contact_created', 'contact_updated', 'contact_unsubscribed',
  'page_view', 'signup', 'trial_started', 'purchase', 'churn',
] as const;

const createEventSchema = z.object({
  type: z.enum(eventTypes),
  contactId: z.string().trim().optional(),
  campaignId: z.string().trim().optional(),
  productId: z.string().trim().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const listEventsSchema = z.object({
  type: z.string().optional(),
  campaignId: z.string().optional(),
  contactId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const params = listEventsSchema.parse({
      type: url.searchParams.get('type') ?? undefined,
      campaignId: url.searchParams.get('campaignId') ?? undefined,
      contactId: url.searchParams.get('contactId') ?? undefined,
      limit: url.searchParams.get('limit') ?? 50,
    });

    let query = adminDb
      .collection(`workspaces/${ctx.workspaceId}/events`)
      .orderBy('timestamp', 'desc');

    if (params.type) query = query.where('type', '==', params.type);
    if (params.campaignId) query = query.where('campaignId', '==', params.campaignId);
    if (params.contactId) query = query.where('contactId', '==', params.contactId);

    const snap = await query.limit(params.limit).get();
    const events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return apiOk({ events, count: events.length });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const data = createEventSchema.parse(body);

    const payload = {
      ...data,
      workspaceId: ctx.workspaceId,
      createdBy: ctx.uid,
      timestamp: new Date().toISOString(),
    };

    const ref = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/events`)
      .add(payload);

    return apiCreated({ id: ref.id, ...payload });
  } catch (error) {
    return apiError(error);
  }
}
