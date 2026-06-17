import { describe, expect, it } from 'vitest';
import { isInstagramGraphUnsupported, IG_LOGIN_UNSUPPORTED_MESSAGE } from './instagram-errors';

describe('isInstagramGraphUnsupported', () => {
  it('matches the IGApiException code 100 "Unsupported request" response', () => {
    expect(
      isInstagramGraphUnsupported({
        error: { code: 100, message: 'Unsupported request - method type: get' },
      }),
    ).toBe(true);
  });

  it('matches on the message even if the code differs', () => {
    expect(
      isInstagramGraphUnsupported({ error: { code: 1, message: 'Unsupported request' } }),
    ).toBe(true);
  });

  it('does NOT match an invalid/expired token (OAuthException 190)', () => {
    expect(
      isInstagramGraphUnsupported({
        error: { code: 190, message: 'Invalid OAuth access token - Cannot parse access token' },
      }),
    ).toBe(false);
  });

  it('does not match when there is no error object', () => {
    expect(isInstagramGraphUnsupported({})).toBe(false);
  });

  it('exposes an actionable message pointing users to the Facebook Page path', () => {
    expect(IG_LOGIN_UNSUPPORTED_MESSAGE).toMatch(/Facebook Page/);
  });
});
