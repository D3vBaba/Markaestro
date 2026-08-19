import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProviderConfig } from '@/lib/oauth/config';
import {
  getPinterestApiEnvironment,
  getPinterestApiUrl,
  isPinterestSandbox,
} from '@/lib/pinterest-api';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Pinterest API environment', () => {
  it('defaults to production', () => {
    vi.stubEnv('PINTEREST_API_ENVIRONMENT', '');
    expect(getPinterestApiEnvironment()).toBe('production');
    expect(isPinterestSandbox()).toBe(false);
    expect(getPinterestApiUrl('/pins')).toBe('https://api.pinterest.com/v5/pins');
  });

  it('uses Sandbox for API and OAuth token requests', () => {
    vi.stubEnv('PINTEREST_API_ENVIRONMENT', 'sandbox');
    expect(getPinterestApiEnvironment()).toBe('sandbox');
    expect(isPinterestSandbox()).toBe(true);
    expect(getPinterestApiUrl('boards')).toBe('https://api-sandbox.pinterest.com/v5/boards');
    expect(getProviderConfig('pinterest').tokenUrl).toBe(
      'https://api-sandbox.pinterest.com/v5/oauth/token',
    );
  });

  it('rejects an invalid environment instead of silently using production', () => {
    vi.stubEnv('PINTEREST_API_ENVIRONMENT', 'trial');
    expect(() => getPinterestApiEnvironment()).toThrow(
      'PINTEREST_API_ENVIRONMENT must be "sandbox" or "production"',
    );
  });

  it('refuses Sandbox on a deployed runtime so production never leaves api.pinterest.com', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PINTEREST_API_ENVIRONMENT', 'sandbox');
    expect(getPinterestApiEnvironment()).toBe('production');
    expect(isPinterestSandbox()).toBe(false);
    expect(getPinterestApiUrl('/pins')).toBe('https://api.pinterest.com/v5/pins');
    expect(getProviderConfig('pinterest').tokenUrl).toBe(
      'https://api.pinterest.com/v5/oauth/token',
    );
  });

  it('still rejects a malformed environment on a deployed runtime', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PINTEREST_API_ENVIRONMENT', 'trial');
    expect(() => getPinterestApiEnvironment()).toThrow(
      'PINTEREST_API_ENVIRONMENT must be "sandbox" or "production"',
    );
  });
});
