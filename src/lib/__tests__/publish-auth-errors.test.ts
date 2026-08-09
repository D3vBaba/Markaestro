import { describe, expect, it } from 'vitest';
import { isPublishAuthFailure, publishAuthFailureMessage } from '@/lib/platform/auth-errors';

describe('isPublishAuthFailure', () => {
  it('recognises the Threads error that left a dead token looking connected', () => {
    // The exact string Graph returned while PawBloom's Threads posts failed
    // for days with a green "Linked" badge on screen.
    expect(isPublishAuthFailure(
      'Threads container create failed (400): Error validating access token: You cannot ' +
      'access the app till you log in to www.threads.com and follow the instructions given.',
    )).toBe(true);
  });

  it.each([
    ['Meta page token', "Facebook access error: ... before impersonating a user's page."],
    ['expired session', 'Error validating access token: Session has expired'],
    ['instagram refusal', "We couldn't authorize this account"],
    ['linkedin revoked', 'LINKEDIN_AUTH_REVOKED'],
    ['oauth exception', 'OAuthException: bad token'],
    ['invalid grant', 'invalid_grant'],
    ['unauthorized', 'Request failed: Unauthorized'],
  ])('recognises %s', (_label, message) => {
    expect(isPublishAuthFailure(message)).toBe(true);
  });

  it.each([
    ['rate limit', 'Application request limit reached'],
    ['server error', 'Threads container create failed (500): Internal server error'],
    ['media problem', 'Instagram requires media (image or video)'],
    ['content too long', 'Caption exceeds the 500 character limit'],
    ['timeout', 'Request timed out'],
    ['empty', ''],
    ['missing', undefined],
  ])('leaves a healthy connection alone for %s', (_label, message) => {
    // Marking a connection for a content or availability problem would
    // disable a channel that is perfectly able to publish.
    expect(isPublishAuthFailure(message)).toBe(false);
  });
});

describe('publishAuthFailureMessage', () => {
  it('gives Facebook the actionable Page instruction', () => {
    expect(publishAuthFailureMessage('facebook', 'Error validating access token'))
      .toMatch(/tick this Page/);
  });

  it('keeps the platform message everywhere else', () => {
    // Threads names the exact step the creator has to take; we cannot say it better.
    const threads = 'You cannot access the app till you log in to www.threads.com';
    expect(publishAuthFailureMessage('threads', threads)).toBe(threads);
  });
});
