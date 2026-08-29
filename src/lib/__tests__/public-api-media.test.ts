import { describe, expect, it } from 'vitest';
import { ApiValidationError } from '@/lib/api-response';
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

  it('tells a HEIC uploader to convert rather than retry', () => {
    for (const type of ['image/heic', 'image/heif']) {
      let thrown: unknown;
      try {
        validatePublicMediaUpload(type, 1024);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ApiValidationError);
      const error = thrown as ApiValidationError;
      expect(error.message).toBe('VALIDATION_INVALID_FILE_TYPE');
      expect(error.userMessage).toContain('Convert the file to JPEG or PNG');
      expect(error.details).toMatchObject({ field: 'contentType', contentType: type });
    }
  });

  it('lists the supported types when any other file type is rejected', () => {
    let thrown: unknown;
    try {
      validatePublicMediaUpload('application/pdf', 1024);
    } catch (error) {
      thrown = error;
    }
    const error = thrown as ApiValidationError;
    expect(error.userMessage).toContain('application/pdf');
    expect(error.userMessage).toContain('image/jpeg');
    expect(error.userMessage).not.toContain('JPEG or PNG');
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
