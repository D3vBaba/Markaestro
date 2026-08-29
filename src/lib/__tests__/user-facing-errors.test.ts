import { afterEach, describe, expect, it } from 'vitest';
import {
  getErrorCode,
  getRequestId,
  getValidationIssueFields,
  resetCommonErrorMessages,
  setCommonErrorMessages,
  userFacingError,
  userFacingIssues,
} from '../user-facing-errors';

afterEach(() => {
  resetCommonErrorMessages();
});

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
    expect(userFacingError({ error: 'VALIDATION_POST_NOT_MEASURED' }, 'Please try again.')).toBe(
      'Please try again.',
    );
  });

  it('renders the server-authored message when the caller has no copy for the code', () => {
    expect(userFacingError(
      {
        error: 'VALIDATION_TOO_MANY_MEDIA_ASSETS',
        userMessage: 'Instagram allows a maximum of 10 media items per post. This post has 12.',
      },
      'Failed to schedule post.',
    )).toBe('Instagram allows a maximum of 10 media items per post. This post has 12.');
  });

  it('still prefers the caller localized copy over the English userMessage', () => {
    expect(userFacingError(
      { error: 'SUBSCRIPTION_REQUIRED', userMessage: 'An active plan is required.' },
      'Upload failed.',
      { SUBSCRIPTION_REQUIRED: 'Un plan actif est requis.' },
    )).toBe('Un plan actif est requis.');
  });

  it('never renders `message`, which can carry provider text', () => {
    expect(userFacingError(
      { error: 'INSTAGRAM_ERROR', message: 'OAuthException: (#100) tried accessing /var/tmp/x.jpg' },
      'Publishing failed.',
    )).toBe('Publishing failed.');
  });

  it('rejects a userMessage that is a stack trace rather than copy', () => {
    expect(userFacingError({ userMessage: 'x'.repeat(401) }, 'Please try again.')).toBe(
      'Please try again.',
    );
    expect(userFacingError({ userMessage: '   ' }, 'Please try again.')).toBe('Please try again.');
  });

  it('covers transport-level codes no screen writes copy for', () => {
    expect(userFacingError({ error: 'INTERNAL_ERROR' }, 'Please try again.')).toBe(
      'Something went wrong on our side. Please try again.',
    );
    expect(userFacingError({ error: 'MALFORMED_RESPONSE' }, 'Please try again.')).toBe(
      'The server sent a response we could not read. Please try again.',
    );
  });

  it('uses registered localized copy for transport-level codes', () => {
    setCommonErrorMessages({ INTERNAL_ERROR: 'Er ging iets mis aan onze kant.' });
    expect(userFacingError({ error: 'INTERNAL_ERROR' }, 'Please try again.')).toBe(
      'Er ging iets mis aan onze kant.',
    );
  });
});

describe('userFacingIssues', () => {
  it('returns one message per validation issue', () => {
    expect(userFacingIssues({
      error: 'VALIDATION_ERROR',
      issues: [
        { channel: 'instagram', message: 'Instagram is not ready: token expired.' },
        { channel: 'linkedin', message: 'LinkedIn allows a maximum of 9 images.' },
      ],
    })).toEqual([
      'Instagram is not ready: token expired.',
      'LinkedIn allows a maximum of 9 images.',
    ]);
  });

  it('deduplicates repeated text and drops issues with none', () => {
    expect(userFacingIssues({
      issues: [{ message: 'Same reason.' }, { message: 'Same reason.' }, { field: 'url' }],
    })).toEqual(['Same reason.']);
  });

  it('returns nothing for payloads without issues', () => {
    expect(userFacingIssues({ error: 'INTERNAL_ERROR' })).toEqual([]);
    expect(userFacingIssues(null)).toEqual([]);
  });
});

describe('getRequestId', () => {
  it('returns the id the server stamped on the failure', () => {
    expect(getRequestId({ requestId: '0f9c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b' })).toBe(
      '0f9c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
    );
  });

  it('rejects ids that are not the shape we mint', () => {
    expect(getRequestId({ requestId: 'short' })).toBeNull();
    expect(getRequestId({ requestId: '<script>alert(1)</script>' })).toBeNull();
    expect(getRequestId({})).toBeNull();
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
