import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
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

/** Prefix identifying a per-workspace conversion ingest key. */
const CONVERSION_KEY_ID_PREFIX = 'mk_ci_';

/** Bumping this rotates every derived key without touching the root secret. */
const CONVERSION_KEY_VERSION = 'v1';

/**
 * Per-workspace ingest secret, derived from the root secret rather than stored.
 *
 * The ingest snippet is handed to customers to run on their own servers, so the
 * signing key is public to whoever holds it. A single process-wide secret
 * therefore let any customer write conversion events, with arbitrary value and
 * currency, into any other customer's workspace, and those events feed
 * attribution and the post leaderboard.
 *
 * Deriving instead of storing means no new collection, no rotation
 * infrastructure, and rotating the root secret rotates every customer key at
 * once. Independent per-customer rotation would come from adding the customer's
 * key version to the derivation input.
 */
export function workspaceIngestSecret(workspaceId: string): string {
  const root = process.env.CONVERSION_INGEST_SECRET || '';
  if (!root) throw new Error('CONVERSION_INGEST_NOT_CONFIGURED');
  return createHmac('sha256', root)
    .update(`conversion-ingest:${CONVERSION_KEY_VERSION}:${workspaceId}`)
    .digest('hex');
}

/** The public key id a customer puts in their snippet. Names its workspace. */
export function workspaceIngestKeyId(workspaceId: string): string {
  return `${CONVERSION_KEY_ID_PREFIX}${workspaceId}`;
}

/**
 * Recover the workspace a key id names. The workspace is taken from the
 * *verified* key id and never from the request body, which is the whole point:
 * a valid signature for workspace A must not be able to write into workspace B.
 */
export function workspaceIdFromIngestKeyId(keyId: string | null | undefined): string | null {
  if (!keyId || !keyId.startsWith(CONVERSION_KEY_ID_PREFIX)) return null;
  const workspaceId = keyId.slice(CONVERSION_KEY_ID_PREFIX.length);
  // Firestore document ids cannot contain a slash, and an empty id would
  // resolve to a collection path.
  if (!workspaceId || workspaceId.includes('/') || workspaceId.length > 128) return null;
  return workspaceId;
}

export type ConversionSignatureResult =
  | { verified: false }
  /** Signed with the workspace's derived key. `workspaceId` is trustworthy. */
  | { verified: true; scope: 'workspace'; workspaceId: string }
  /**
   * Signed with the legacy process-wide secret, which names no workspace.
   * Accepted for one release so existing snippets keep working; every hit is
   * logged with the workspace it claimed so the stragglers can be chased.
   */
  | { verified: true; scope: 'global'; workspaceId: null };

/**
 * Verify an ingest signature, preferring the per-workspace key.
 *
 * `keyId` comes from the `x-markaestro-key-id` header. When it is present and
 * well formed, only that workspace's derived secret is accepted. When it is
 * absent, the legacy global secret is tried, for the migration window only.
 */
export function verifyConversionRequest(
  rawBody: string,
  signature: string | null,
  keyId: string | null,
): ConversionSignatureResult {
  if (!signature) return { verified: false };
  const root = process.env.CONVERSION_INGEST_SECRET || '';
  if (!root) return { verified: false };
  const provided = signature.replace(/^sha256=/, '');

  const workspaceId = workspaceIdFromIngestKeyId(keyId);
  if (workspaceId) {
    const expected = conversionSignature(rawBody, workspaceIngestSecret(workspaceId));
    return safeCompare(expected, provided)
      ? { verified: true, scope: 'workspace', workspaceId }
      : { verified: false };
  }

  // A key id was sent but is malformed: fail rather than silently falling back
  // to the global path, which would be a downgrade an attacker controls.
  if (keyId) return { verified: false };

  return safeCompare(conversionSignature(rawBody, root), provided)
    ? { verified: true, scope: 'global', workspaceId: null }
    : { verified: false };
}

/** @deprecated Use `verifyConversionRequest`, which binds the workspace. */
export function verifyConversionSignature(rawBody: string, signature: string | null): boolean {
  return verifyConversionRequest(rawBody, signature, null).verified;
}

function trackedLinkRefs(workspaceId: string, code: string) {
  return [
    adminDb.doc(`trackedLinks/${code}`),
    adminDb.doc(`workspaces/${workspaceId}/trackedLinks/${code}`),
  ];
}

/**
 * Counters live on the tracked-link documents themselves, so listing links
 * never scans click events: two increments per click, zero reads to display.
 */
export async function recordTrackedLinkClick(input: {
  workspaceId: string;
  code: string;
  clickedAt: string;
}): Promise<void> {
  const batch = adminDb.batch();
  for (const ref of trackedLinkRefs(input.workspaceId, input.code)) {
    batch.set(ref, {
      clicks: FieldValue.increment(1),
      lastClickedAt: input.clickedAt,
      updatedAt: input.clickedAt,
    }, { merge: true });
  }
  await batch.commit();
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
  const batch = adminDb.batch();
  batch.create(ref, {
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
  // Last-click attribution is what the tracked-link list reports.
  const attributedCode = typeof last?.trackedLinkCode === 'string' ? last.trackedLinkCode : null;
  if (attributedCode) {
    for (const linkRef of trackedLinkRefs(input.workspaceId, attributedCode)) {
      batch.set(linkRef, {
        attributedConversions: FieldValue.increment(1),
        lastConversionAt: input.occurredAt,
        updatedAt: now,
      }, { merge: true });
    }
  }
  await batch.commit();
  return { id, created: true, attributed };
}
