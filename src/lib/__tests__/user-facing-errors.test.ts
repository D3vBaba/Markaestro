import { describe, expect, it } from 'vitest';
import { getErrorCode, getValidationIssueFields, userFacingError } from '../user-facing-errors';

describe('getErrorCode', () => {
  it('extracts stable application error codes', () => {
    expect(getErrorCode('SUBSCRIPTION_REQUIRED')).toBe('SUBSCRIPTION_REQUIRED');
    expect(getErrorCode(new Error('REQUEST_TIMEOUT'))).toBe('REQUEST_TIMEOUT');
    expect(getErrorCode({ error: 'QUOTA_EXCEEDED_MEDIA_UPLOADS' })).toBe(
      'QUOTA_EXCEEDED_MEDIA_UPLOADS',
    );
  });

  it('rejects free text and provider payloads', () => {
    expect(getErrorCode('photo.jpg: upload failed')).toBeNull();
    expect(getErrorCode(new Error('LinkedIn API error (500): upstream body'))).toBeNull();
    expect(getErrorCode({ error: 'token=secret', message: 'raw provider response' })).toBeNull();
  });
});

describe('userFacingError', () => {
  it('uses application-owned copy for explicitly mapped codes', () => {
    expect(userFacingError(
      { error: 'SUBSCRIPTION_REQUIRED', message: 'raw text must not win' },
      'Upload failed.',
      { SUBSCRIPTION_REQUIRED: 'An active plan is required to upload media.' },
    )).toBe('An active plan is required to upload media.');
  });

  it('uses the safe fallback for unknown strings and unmapped codes', () => {
    expect(userFacingError({ error: 'random upstream response' }, 'Please try again.')).toBe(
      'Please try again.',
    );
    expect(userFacingError({ error: 'INTERNAL_ERROR' }, 'Please try again.')).toBe(
      'Please try again.',
    );
  });
});

describe('getValidationIssueFields', () => {
  it('returns field paths from a VALIDATION_ERROR payload', () => {
    expect(getValidationIssueFields({
      error: 'VALIDATION_ERROR',
      issues: [{ field: 'url', code: 'invalid_format' }, { field: 'description', code: 'too_big' }],
    })).toEqual(['url', 'description']);
  });

  it('ignores non-validation payloads', () => {
    expect(getValidationIssueFields({ error: 'INTERNAL_ERROR', issues: [{ field: 'url' }] })).toEqual([]);
  });
});
