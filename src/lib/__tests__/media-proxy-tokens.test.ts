import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MEDIA_PROXY_TOKEN_TTL_MS,
  enforceMediaProxyToken,
  mediaProxyTokenRequired,
  mintMediaProxyToken,
  verifyMediaProxyToken,
} from '@/lib/media/proxy-tokens';

const URL_A = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/a.jpg?alt=media&token=x';
const URL_B = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/b.jpg?alt=media&token=y';

describe('media proxy tokens', () => {
  beforeEach(() => {
    vi.stubEnv('WORKER_SECRET', 'unit-test-media-proxy-secret');
    vi.stubEnv('MEDIA_PROXY_REQUIRE_TOKEN', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('verifies a token it just minted', () => {
    const token = mintMediaProxyToken(URL_A, 'video');
    expect(token).toBeTruthy();
    expect(verifyMediaProxyToken(token, URL_A, 'video')).toEqual({ state: 'valid' });
  });

  it('refuses a token minted for a different url', () => {
    const token = mintMediaProxyToken(URL_A, 'video');
    expect(verifyMediaProxyToken(token, URL_B, 'video')).toEqual({
      state: 'invalid',
      reason: 'signature',
    });
  });

  it('refuses a token minted for a different media kind', () => {
    const token = mintMediaProxyToken(URL_A, 'image');
    expect(verifyMediaProxyToken(token, URL_A, 'video')).toEqual({
      state: 'invalid',
      reason: 'signature',
    });
  });

  it('refuses a token past its expiry', () => {
    vi.useFakeTimers();
    const token = mintMediaProxyToken(URL_A, 'video');
    vi.advanceTimersByTime(MEDIA_PROXY_TOKEN_TTL_MS + 1000);
    expect(verifyMediaProxyToken(token, URL_A, 'video')).toEqual({
      state: 'invalid',
      reason: 'expired',
    });
  });

  it('reports a missing token as absent rather than invalid', () => {
    expect(verifyMediaProxyToken(null, URL_A, 'video')).toEqual({ state: 'absent' });
    expect(verifyMediaProxyToken('', URL_A, 'video')).toEqual({ state: 'absent' });
  });

  it('reports a malformed token without throwing', () => {
    expect(verifyMediaProxyToken('nonsense', URL_A, 'video')).toEqual({
      state: 'invalid',
      reason: 'malformed',
    });
    expect(verifyMediaProxyToken('.sig', URL_A, 'video')).toEqual({
      state: 'invalid',
      reason: 'malformed',
    });
  });

  it('mints nothing when no signing secret is configured', () => {
    vi.stubEnv('WORKER_SECRET', '');
    vi.stubEnv('DATA_ENCRYPTION_KEY', '');
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(mintMediaProxyToken(URL_A, 'video')).toBeNull();
  });
});

describe('media proxy token enforcement', () => {
  beforeEach(() => {
    vi.stubEnv('WORKER_SECRET', 'unit-test-media-proxy-secret');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('defaults to accepting unsigned requests so in-flight platform pulls survive a deploy', () => {
    vi.stubEnv('MEDIA_PROXY_REQUIRE_TOKEN', '');
    expect(mediaProxyTokenRequired()).toBe(false);
    expect(
      enforceMediaProxyToken({ token: null, mediaUrl: URL_A, kind: 'video', route: '/t' }),
    ).toBeNull();
  });

  it('refuses unsigned requests once enforcement is on', () => {
    vi.stubEnv('MEDIA_PROXY_REQUIRE_TOKEN', '1');
    expect(mediaProxyTokenRequired()).toBe(true);
    const refusal = enforceMediaProxyToken({
      token: null,
      mediaUrl: URL_A,
      kind: 'video',
      route: '/t',
    });
    expect(refusal?.status).toBe(403);
  });

  it('lets a correctly signed request through under enforcement', () => {
    vi.stubEnv('MEDIA_PROXY_REQUIRE_TOKEN', '1');
    const token = mintMediaProxyToken(URL_A, 'video');
    expect(
      enforceMediaProxyToken({ token, mediaUrl: URL_A, kind: 'video', route: '/t' }),
    ).toBeNull();
  });

  it('refuses a signature lifted from another url under enforcement', () => {
    vi.stubEnv('MEDIA_PROXY_REQUIRE_TOKEN', '1');
    const token = mintMediaProxyToken(URL_A, 'video');
    const refusal = enforceMediaProxyToken({
      token,
      mediaUrl: URL_B,
      kind: 'video',
      route: '/t',
    });
    expect(refusal?.status).toBe(403);
  });
});
