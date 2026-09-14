import { describe, expect, it } from 'vitest';
import { classifyPublishError } from '@/lib/social/publisher';

describe('publish error classification', () => {
  it('does not retry a provider spending circuit breaker', () => {
    expect(classifyPublishError('CHANNEL_BILLING_ACTION_REQUIRED')).toEqual({
      code: 'CHANNEL_BILLING_ACTION_REQUIRED',
      category: 'permanent',
      retryable: false,
    });
  });
});
