import { describe, expect, it } from 'vitest';
import { buildApiKey, buildWebhookSecret, parseApiKey } from '../public-api/keys';

describe('public API keys', () => {
  it('builds and parses workspace-scoped API keys', () => {
    const built = buildApiKey('ws_demo', 'cli_demo');
    const parsed = parseApiKey(built.token);

    expect(parsed).toEqual({
      workspaceId: 'ws_demo',
      clientId: 'cli_demo',
      secret: expect.any(String),
    });
    expect(parsed?.secret.length).toBeGreaterThan(10);
  });

  it('rejects malformed API keys', () => {
    expect(parseApiKey('bad-key')).toBeNull();
    expect(parseApiKey('mk_live_missingparts')).toBeNull();
  });

  it('creates webhook secrets with the expected prefix', () => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key';
    const secret = buildWebhookSecret();
    expect(secret.secret.startsWith('whsec_')).toBe(true);
    expect(secret.secretHash.length).toBeGreaterThan(10);
    expect(secret.secretEncrypted.length).toBeGreaterThan(10);
  });
});
