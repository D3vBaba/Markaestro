/**
 * Metadata helpers shared by the upload surfaces that create asset records.
 *
 * Kept separate from `asset-store.ts` so that module stays free of the `sharp`
 * import, which is heavy and only the upload paths need.
 */

import { MEDIA_UPLOAD_TYPES } from '@/lib/media-upload-policy';
import type { MediaAssetType } from './asset-store';

export function mediaAssetTypeForMimeType(mimeType: string): MediaAssetType {
  return mimeType.startsWith('video/') ? 'video' : 'image';
}

export type ImageDimensions = { width: number | null; height: number | null };

/**
 * Read an image's pixel dimensions, returning nulls rather than throwing.
 *
 * Dimensions are a nice-to-have for the media library; a `sharp` decode failure
 * on an unusual-but-valid file must not fail an upload the user has already
 * paid storage bytes for.
 */
export async function readImageDimensions(
  buffer: Buffer,
  mimeType: string,
): Promise<ImageDimensions> {
  if (mediaAssetTypeForMimeType(mimeType) !== 'image') return { width: null, height: null };
  try {
    const sharp = (await import('sharp')).default;
    const metadata = await sharp(buffer, { animated: true }).metadata();
    return { width: metadata.width ?? null, height: metadata.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

/** True when this MIME type is one the in-app upload paths accept. */
export function isSupportedUploadType(mimeType: string): boolean {
  return MEDIA_UPLOAD_TYPES.has(mimeType);
}
