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
      mode: 'live',
    });
    expect(parsed?.secret.length).toBeGreaterThan(10);
  });

  it('carries the mode in the prefix, so a test key is visible on sight', () => {
    // The mode has to survive a log line, a screenshot, or a pasted curl
    // command without anyone looking the key up, which is why it lives in the
    // prefix rather than only in the stored record. `auth.ts` refuses a token
    // whose prefix disagrees with what the record says.
    const test = buildApiKey('ws_demo', 'cli_demo', 'test');
    expect(test.token.startsWith('mk_test_')).toBe(true);
    expect(test.mode).toBe('test');
    expect(parseApiKey(test.token)?.mode).toBe('test');

    const live = buildApiKey('ws_demo', 'cli_demo');
    expect(live.token.startsWith('mk_live_')).toBe(true);
    expect(parseApiKey(live.token)?.mode).toBe('live');
  });

  it('rejects malformed API keys', () => {
    expect(parseApiKey('bad-key')).toBeNull();
    expect(parseApiKey('mk_live_missingparts')).toBeNull();
    expect(parseApiKey('mk_test_missingparts')).toBeNull();
    // An unrecognised prefix is not a key, whatever follows it.
    expect(parseApiKey('mk_sandbox_ws.cli.secret')).toBeNull();
  });

  it('creates webhook secrets with the expected prefix', () => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key';
    const secret = buildWebhookSecret();
    expect(secret.secret.startsWith('whsec_')).toBe(true);
    expect(secret.secretHash.length).toBeGreaterThan(10);
    expect(secret.secretEncrypted.length).toBeGreaterThan(10);
  });
});
