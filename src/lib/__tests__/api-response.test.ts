import { describe, expect, it } from 'vitest';
import { apiError, publicValidationIssueMessage } from '../api-response';

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
});
