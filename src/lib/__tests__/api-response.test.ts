import { describe, expect, it } from 'vitest';
import { ApiValidationError, apiError, authoredError, publicValidationIssueMessage } from '../api-response';
import { withRequestContext } from '../request-context';

describe('publicValidationIssueMessage', () => {
  it('returns application-owned validation copy', () => {
    expect(publicValidationIssueMessage('too_small')).toBe(
      'This value is required or below the minimum.',
    );
    expect(publicValidationIssueMessage('unrecognized_keys')).toBe(
      'One or more fields are not supported.',
    );
  });

  it('uses a safe generic message for unknown issue codes', () => {
    expect(publicValidationIssueMessage('provider_supplied_code')).toBe('This value is invalid.');
  });
});

describe('apiError', () => {
  it('maps quota codes to 402', async () => {
    for (const code of ['QUOTA_EXCEEDED_STORAGE', 'QUOTA_EXCEEDED_POSTS']) {
      const response = apiError(new Error(code));
      expect(response.status).toBe(402);
      expect(await response.json()).toMatchObject({ error: code });
    }
  });

  it('preserves intentional HTTP responses such as rate limits', async () => {
    const response = new Response(JSON.stringify({ error: 'RATE_LIMITED' }), {
      status: 429,
      headers: { 'Retry-After': '10' },
    });
    const result = apiError(response);
    expect(result).toBe(response);
    expect(result.status).toBe(429);
    expect(result.headers.get('Retry-After')).toBe('10');
  });

  it('renders a structured validation error with its message and details', async () => {
    const response = apiError(
      new ApiValidationError(
        'VALIDATION_TOO_MANY_MEDIA_ASSETS',
        'Instagram allows a maximum of 10 media items per post. This post has 12.',
        { field: 'mediaAssetIds', channel: 'instagram', limit: 10, received: 12 },
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'VALIDATION_TOO_MANY_MEDIA_ASSETS',
      message: 'Instagram allows a maximum of 10 media items per post. This post has 12.',
      field: 'mediaAssetIds',
      channel: 'instagram',
      limit: 10,
      received: 12,
    });
  });

  it('marks server-authored copy as user-safe on the wire', async () => {
    // `userMessage` is the field userFacingError renders. `message` is kept
    // for existing API consumers but is shared with routes that proxy
    // provider payloads, so the client must never render it.
    const response = apiError(new Error('BRAND_LIMIT_REACHED'));
    const body = await response.json();
    expect(response.status).toBe(402);
    expect(body.userMessage).toContain('brand limit');
    expect(body.message).toBe(body.userMessage);
  });

  it('never sets userMessage for an error nobody wrote copy for', async () => {
    const body = await apiError(new Error('some upstream explosion')).json();
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.userMessage).toBeUndefined();
  });

  it('reuses the ambient request id so the toast matches the logs', async () => {
    const body = await withRequestContext(
      { requestId: 'ambient-req-0001' },
      () => apiError(new Error('NOT_FOUND')).json(),
    );
    expect(body.requestId).toBe('ambient-req-0001');
  });

  it('mints a request id when called outside a request', async () => {
    const body = await apiError(new Error('NOT_FOUND')).json();
    expect(body.requestId).toMatch(/^[A-Za-z0-9-]{8,}$/);
  });

  it('carries structured details alongside the authored copy', async () => {
    const response = authoredError('VALIDATION_CHANNEL_NOT_READY', 'Instagram is not ready.', {
      status: 400,
      details: { channel: 'instagram', reason: 'token_expired' },
    });
    expect(await response.json()).toMatchObject({
      error: 'VALIDATION_CHANNEL_NOT_READY',
      userMessage: 'Instagram is not ready.',
      channel: 'instagram',
      reason: 'token_expired',
    });
  });
});
