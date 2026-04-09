import crypto from 'crypto';
import sharp from 'sharp';
import { adminDb } from '@/lib/firebase-admin';
import { uploadToStorage } from '@/lib/storage';
import type { PublicApiContext } from './auth';

export const PUBLIC_ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export const PUBLIC_MAX_IMAGE_SIZE = 10 * 1024 * 1024;

export type PublicMediaAsset = {
  id: string;
  type: 'image';
  storagePath: string;
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  originalFileName: string;
  createdByType: 'api_client' | 'user';
  createdById: string;
  createdAt: string;
};

export async function createMediaAsset(
  ctx: PublicApiContext,
  file: File,
  buffer: Buffer,
): Promise<PublicMediaAsset> {
  if (!PUBLIC_ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error('VALIDATION_INVALID_FILE_TYPE');
  }
  if (file.size > PUBLIC_MAX_IMAGE_SIZE) {
    throw new Error('VALIDATION_FILE_TOO_LARGE_10MB');
  }

  const metadata = await sharp(buffer, { animated: true }).metadata();
  const assetId = `ast_${crypto.randomUUID()}`;
  const ext = file.type === 'image/png'
    ? 'png'
    : file.type === 'image/webp'
      ? 'webp'
      : file.type === 'image/gif'
        ? 'gif'
        : 'jpg';
  const storagePath = `workspaces/${ctx.workspaceId}/public-media/${assetId}.${ext}`;
  const createdAt = new Date().toISOString();
  const downloadUrl = await uploadToStorage(storagePath, buffer, file.type, {
    workspaceId: ctx.workspaceId,
    createdByType: ctx.principalType,
    createdById: ctx.clientId,
    createdAt,
    originalFileName: file.name,
  });

  const asset: PublicMediaAsset = {
    id: assetId,
    type: 'image',
    storagePath,
    downloadUrl,
    mimeType: file.type,
    sizeBytes: file.size,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    originalFileName: file.name,
    createdByType: ctx.principalType,
    createdById: ctx.clientId,
    createdAt,
  };

  await adminDb.doc(`workspaces/${ctx.workspaceId}/media_assets/${assetId}`).set(asset);
  return asset;
}

export async function resolveMediaAssetUrls(workspaceId: string, assetIds: string[]) {
  if (assetIds.length === 0) return [];

  const refs = assetIds.map((assetId) => adminDb.doc(`workspaces/${workspaceId}/media_assets/${assetId}`));
  const snaps = await adminDb.getAll(...refs);

  return snaps.map((snap) => {
    if (!snap.exists) throw new Error('NOT_FOUND');
    const data = snap.data() as PublicMediaAsset;
    return {
      id: snap.id,
      url: data.downloadUrl,
      mimeType: data.mimeType,
    };
  });
}
