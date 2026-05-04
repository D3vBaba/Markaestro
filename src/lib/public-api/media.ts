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

export const PUBLIC_ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
  'video/x-matroska',
]);

export const PUBLIC_MAX_IMAGE_SIZE = 10 * 1024 * 1024;
export const PUBLIC_MAX_VIDEO_SIZE = 250 * 1024 * 1024; // 250 MB

export type PublicMediaAsset = {
  id: string;
  type: 'image' | 'video';
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

export type ResolvedPublicMediaAsset = {
  id: string;
  url: string;
  mimeType: string;
  type: PublicMediaAsset['type'];
};

const VIDEO_EXT_MAP: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-msvideo': 'avi',
  'video/x-matroska': 'mkv',
};

export async function createMediaAsset(
  ctx: PublicApiContext,
  file: File,
  buffer: Buffer,
): Promise<PublicMediaAsset> {
  const isImage = PUBLIC_ALLOWED_IMAGE_TYPES.has(file.type);
  const isVideo = PUBLIC_ALLOWED_VIDEO_TYPES.has(file.type);

  if (!isImage && !isVideo) {
    throw new Error('VALIDATION_INVALID_FILE_TYPE');
  }
  if (isImage && file.size > PUBLIC_MAX_IMAGE_SIZE) {
    throw new Error('VALIDATION_FILE_TOO_LARGE_10MB');
  }
  if (isVideo && file.size > PUBLIC_MAX_VIDEO_SIZE) {
    throw new Error('VALIDATION_FILE_TOO_LARGE_250MB');
  }

  let width: number | null = null;
  let height: number | null = null;

  if (isImage) {
    const metadata = await sharp(buffer, { animated: true }).metadata();
    width = metadata.width ?? null;
    height = metadata.height ?? null;
  }

  const assetId = `ast_${crypto.randomUUID()}`;
  const ext = isVideo
    ? (VIDEO_EXT_MAP[file.type] || 'mp4')
    : file.type === 'image/png'
      ? 'png'
      : file.type === 'image/webp'
        ? 'webp'
        : file.type === 'image/gif'
          ? 'gif'
          : 'jpg';
  const subdir = isVideo ? 'videos' : 'public-media';
  const storagePath = `workspaces/${ctx.workspaceId}/${subdir}/${assetId}.${ext}`;
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
    type: isVideo ? 'video' : 'image',
    storagePath,
    downloadUrl,
    mimeType: file.type,
    sizeBytes: file.size,
    width,
    height,
    originalFileName: file.name,
    createdByType: ctx.principalType,
    createdById: ctx.clientId,
    createdAt,
  };

  await adminDb.doc(`workspaces/${ctx.workspaceId}/media_assets/${assetId}`).set(asset);
  return asset;
}

export async function resolveMediaAssetUrls(workspaceId: string, assetIds: string[]): Promise<ResolvedPublicMediaAsset[]> {
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
      type: data.type,
    };
  });
}
