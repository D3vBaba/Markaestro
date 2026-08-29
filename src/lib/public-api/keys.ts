import crypto from 'crypto';
import { encrypt } from '@/lib/crypto';

/**
 * Key prefixes carry the mode.
 *
 * A test key is a real key in a real workspace: it creates real posts and real
 * media, so an integrator exercises the actual API rather than a stub of it.
 * The one thing it does not do is call a platform, and the prefix is what
 * makes that visible in a log line, a screenshot, or a pasted curl command
 * without anyone having to look the key up.
 */
const API_KEY_PREFIXES = {
  live: 'mk_live_',
  test: 'mk_test_',
} as const;

export type ApiKeyMode = keyof typeof API_KEY_PREFIXES;

export const apiKeyModes = ['live', 'test'] as const satisfies readonly ApiKeyMode[];

const WEBHOOK_SECRET_PREFIX = 'whsec_';

export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function buildApiKey(workspaceId: string, clientId: string, mode: ApiKeyMode = 'live') {
  const secret = randomToken(24);
  const token = `${API_KEY_PREFIXES[mode]}${workspaceId}.${clientId}.${secret}`;
  return {
    token,
    mode,
    keyPrefix: secret.slice(0, 12),
    secretHash: hashSecret(secret),
  };
}

export function parseApiKey(
  token: string,
): { workspaceId: string; clientId: string; secret: string; mode: ApiKeyMode } | null {
  const mode = apiKeyModes.find((candidate) => token.startsWith(API_KEY_PREFIXES[candidate]));
  if (!mode) return null;
  const raw = token.slice(API_KEY_PREFIXES[mode].length);
  const firstSep = raw.indexOf('.');
  const secondSep = raw.indexOf('.', firstSep + 1);
  if (firstSep <= 0 || secondSep <= firstSep + 1 || secondSep >= raw.length - 1) {
    return null;
  }

  const workspaceId = raw.slice(0, firstSep).trim();
  const clientId = raw.slice(firstSep + 1, secondSep).trim();
  const secret = raw.slice(secondSep + 1).trim();

  if (!workspaceId || !clientId || !secret) return null;
  return { workspaceId, clientId, secret, mode };
}

export function buildWebhookSecret() {
  const secret = `${WEBHOOK_SECRET_PREFIX}${randomToken(24)}`;
  return {
    secret,
    secretHash: hashSecret(secret),
    secretEncrypted: encrypt(secret),
  };
}
