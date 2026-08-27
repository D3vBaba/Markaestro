import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { safeCompare } from '@/lib/crypto';

export const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 30;

export function createTrackingCode(): string {
  return randomBytes(9).toString('base64url');
}

export function createClickId(): string {
  return randomUUID().replace(/-/g, '');
}

export function appendClickId(destination: string, clickId: string): string {
  const url = new URL(destination);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('VALIDATION_INVALID_DESTINATION');
  url.searchParams.set('mkcid', clickId);
  return url.toString();
}

export function conversionSignature(rawBody: string, secret = process.env.CONVERSION_INGEST_SECRET || ''): string {
  if (!secret) throw new Error('CONVERSION_INGEST_NOT_CONFIGURED');
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyConversionSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.CONVERSION_INGEST_SECRET || '';
  if (!secret || !signature) return false;
  return safeCompare(conversionSignature(rawBody, secret), signature.replace(/^sha256=/, ''));
}

export async function recordConversionEvent(input: {
  workspaceId: string;
  idempotencyId: string;
  eventType: string;
  occurredAt: string;
  firstClickId?: string;
  lastClickId?: string;
  value?: number;
  currency?: string;
  consent: boolean;
  source: 'browser' | 'server';
}): Promise<{ id: string; created: boolean; attributed: boolean }> {
  const id = createHash('sha256')
    .update(`${input.workspaceId}\0${input.idempotencyId}`)
    .digest('base64url')
    .slice(0, 48);
  const ref = adminDb.doc(`workspaces/${input.workspaceId}/conversionEvents/${id}`);
  const existing = await ref.get();
  if (existing.exists) return { id, created: false, attributed: Boolean(existing.data()?.attributed) };

  const clickIds = [...new Set([input.firstClickId, input.lastClickId].filter((value): value is string => Boolean(value)))];
  const clicks = await Promise.all(clickIds.map((clickId) => adminDb.doc(`conversionClicks/${clickId}`).get()));
  const cutoff = Date.parse(input.occurredAt) - DEFAULT_ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60_000;
  const valid = clicks.filter((click) =>
    click.exists
    && click.data()?.workspaceId === input.workspaceId
    && Date.parse(String(click.data()?.clickedAt || '')) >= cutoff,
  );
  const byId = new Map(valid.map((click) => [click.id, click.data()!]));
  const first = input.firstClickId ? byId.get(input.firstClickId) : undefined;
  const last = input.lastClickId ? byId.get(input.lastClickId) : first;
  const attributed = Boolean(first || last);
  const now = new Date().toISOString();
  await ref.create({
    id,
    workspaceId: input.workspaceId,
    idempotencyIdHash: createHash('sha256').update(input.idempotencyId).digest('hex'),
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    value: input.value ?? null,
    currency: input.currency ?? null,
    consent: input.consent,
    source: input.source,
    attributed,
    firstClick: first ? { clickId: input.firstClickId, trackedLinkCode: first.trackedLinkCode, campaignId: first.campaignId || null } : null,
    lastClick: last ? { clickId: input.lastClickId || input.firstClickId, trackedLinkCode: last.trackedLinkCode, campaignId: last.campaignId || null } : null,
    attributionWindowDays: DEFAULT_ATTRIBUTION_WINDOW_DAYS,
    createdAt: now,
  });
  return { id, created: true, attributed };
}
