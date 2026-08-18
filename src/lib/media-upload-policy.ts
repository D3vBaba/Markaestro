export const MAX_IMAGE_UPLOAD_SIZE = 10 * 1024 * 1024;
export const MAX_VIDEO_UPLOAD_SIZE = 250 * 1024 * 1024;

export const IMAGE_UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const VIDEO_UPLOAD_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
export const MEDIA_UPLOAD_TYPES = new Set([...IMAGE_UPLOAD_TYPES, ...VIDEO_UPLOAD_TYPES]);

export function validateMediaUpload(type: string, size: number): { isVideo: boolean; extension: string } {
  if (!MEDIA_UPLOAD_TYPES.has(type)) throw new Error('VALIDATION_INVALID_FILE_TYPE');
  const isVideo = VIDEO_UPLOAD_TYPES.has(type);
  if (!Number.isFinite(size) || size <= 0) throw new Error('VALIDATION_NO_FILE_PROVIDED');
  if (size > (isVideo ? MAX_VIDEO_UPLOAD_SIZE : MAX_IMAGE_UPLOAD_SIZE)) {
    throw new Error('VALIDATION_FILE_TOO_LARGE');
  }
  const extension = isVideo
    ? type === 'video/quicktime' ? 'mov' : type === 'video/webm' ? 'webm' : 'mp4'
    : type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/gif' ? 'gif' : 'jpg';
  return { isVideo, extension };
}
