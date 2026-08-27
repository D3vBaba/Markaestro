import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { adminDb } from '@/lib/firebase-admin';
import { uploadPrivateToStorage } from '@/lib/storage';
import type { SocialChannel } from '@/lib/schemas';

const RAW_RETENTION_MS = 90 * 24 * 60 * 60_000;

/** Persist an immutable compressed adapter payload before availability normalization. */
export async function persistRawPlatformMetrics(input: {
  workspaceId: string;
  socialPostId: string;
  channel: SocialChannel;
  provider: string;
  apiVersion: string;
  externalId: string;
  capturedAt: string;
  payload: unknown;
}): Promise<{ id: string; checksum: string; storageUri: string }> {
  const json = Buffer.from(JSON.stringify(input.payload));
  const checksum = createHash('sha256').update(json).digest('hex');
  const id = createHash('sha256').update(`${input.socialPostId}\0${input.capturedAt}\0${checksum}`).digest('base64url').slice(0, 48);
  const date = input.capturedAt.slice(0, 10);
  const path = `workspaces/${input.workspaceId}/private-intelligence/raw-platform-metrics/${date}/${id}.json.gz`;
  const storageUri = await uploadPrivateToStorage(path, gzipSync(json), 'application/gzip', {
    checksumSha256: checksum,
    expiresAt: new Date(Date.parse(input.capturedAt) + RAW_RETENTION_MS).toISOString(),
  });
  await adminDb.doc(`workspaces/${input.workspaceId}/rawPlatformMetrics/${id}`).create({
    id,
    workspaceId: input.workspaceId,
    socialPostId: input.socialPostId,
    channel: input.channel,
    provider: input.provider,
    apiVersion: input.apiVersion,
    externalIdHash: createHash('sha256').update(input.externalId).digest('hex'),
    checksum,
    storageUri,
    byteLength: json.byteLength,
    capturedAt: input.capturedAt,
    expiresAt: new Date(Date.parse(input.capturedAt) + RAW_RETENTION_MS),
    schemaVersion: 1,
  }).catch((error: unknown) => {
    const code = (error as { code?: number | string }).code;
    if (code !== 6 && code !== 'already-exists') throw error;
  });
  return { id, checksum, storageUri };
}
