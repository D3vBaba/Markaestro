import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk, apiCreated } from '@/lib/api-response';
import { executeListQuery, type FieldFilter } from '@/lib/firestore-list-query';
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
    requirePermission(ctx, 'analytics.read');
    const url = new URL(req.url);
    const params = listEventsSchema.parse({
      type: url.searchParams.get('type') ?? undefined,
      campaignId: url.searchParams.get('campaignId') ?? undefined,
      contactId: url.searchParams.get('contactId') ?? undefined,
      limit: url.searchParams.get('limit') ?? 50,
    });

    const filters: FieldFilter[] = [
      params.type       && { field: 'type',       op: '==', value: params.type },
      params.campaignId && { field: 'campaignId', op: '==', value: params.campaignId },
      params.contactId  && { field: 'contactId',  op: '==', value: params.contactId },
    ].filter(Boolean) as FieldFilter[];

    const events = await executeListQuery(
      adminDb.collection(`workspaces/${ctx.workspaceId}/events`),
      { filters, orderByField: 'timestamp', limit: params.limit },
    );
    return apiOk({ events, count: events.length });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'events.write');
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
