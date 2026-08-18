import { describe, expect, it } from 'vitest';
import {
  PUBLIC_MAX_IMAGE_SIZE,
  PUBLIC_MAX_VIDEO_SIZE,
  publicMediaExtension,
  validatePublicMediaUpload,
} from '@/lib/public-api/media';

describe('public API media upload policy', () => {
  it('accepts supported image and video types at their size limits', () => {
    expect(validatePublicMediaUpload('image/png', PUBLIC_MAX_IMAGE_SIZE)).toBe('image');
    expect(validatePublicMediaUpload('video/mp4', PUBLIC_MAX_VIDEO_SIZE)).toBe('video');
  });

  it('rejects unsupported, empty, and oversized uploads', () => {
    expect(() => validatePublicMediaUpload('application/pdf', 100)).toThrow('VALIDATION_INVALID_FILE_TYPE');
    expect(() => validatePublicMediaUpload('image/jpeg', 0)).toThrow('VALIDATION_NO_FILE_PROVIDED');
    expect(() => validatePublicMediaUpload('image/jpeg', PUBLIC_MAX_IMAGE_SIZE + 1))
      .toThrow('VALIDATION_FILE_TOO_LARGE_10MB');
    expect(() => validatePublicMediaUpload('video/mp4', PUBLIC_MAX_VIDEO_SIZE + 1))
      .toThrow('VALIDATION_FILE_TOO_LARGE_250MB');
  });

  it('uses stable storage extensions for every supported type', () => {
    expect(publicMediaExtension('image/jpeg')).toBe('jpg');
    expect(publicMediaExtension('image/png')).toBe('png');
    expect(publicMediaExtension('image/webp')).toBe('webp');
    expect(publicMediaExtension('image/gif')).toBe('gif');
    expect(publicMediaExtension('video/mp4')).toBe('mp4');
    expect(publicMediaExtension('video/quicktime')).toBe('mov');
    expect(publicMediaExtension('video/webm')).toBe('webm');
    expect(publicMediaExtension('video/x-msvideo')).toBe('avi');
    expect(publicMediaExtension('video/x-matroska')).toBe('mkv');
  });
});
