import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_UPLOAD_SIZE,
  MAX_VIDEO_UPLOAD_SIZE,
  validateMediaUpload,
} from '../media-upload-policy';

describe('media upload policy', () => {
  it('accepts supported image and video types at their limits', () => {
    expect(validateMediaUpload('image/png', MAX_IMAGE_UPLOAD_SIZE)).toEqual({
      isVideo: false,
      extension: 'png',
    });
    expect(validateMediaUpload('video/quicktime', MAX_VIDEO_UPLOAD_SIZE)).toEqual({
      isVideo: true,
      extension: 'mov',
    });
  });

  it('rejects empty, oversized, and unsupported uploads', () => {
    expect(() => validateMediaUpload('image/png', 0)).toThrow('VALIDATION_NO_FILE_PROVIDED');
    expect(() => validateMediaUpload('image/png', MAX_IMAGE_UPLOAD_SIZE + 1))
      .toThrow('VALIDATION_FILE_TOO_LARGE');
    expect(() => validateMediaUpload('video/mp4', MAX_VIDEO_UPLOAD_SIZE + 1))
      .toThrow('VALIDATION_FILE_TOO_LARGE');
    expect(() => validateMediaUpload('image/svg+xml', 100))
      .toThrow('VALIDATION_INVALID_FILE_TYPE');
  });
});
