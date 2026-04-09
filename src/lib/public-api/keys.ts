import crypto from 'crypto';
import { encrypt } from '@/lib/crypto';

const API_KEY_PREFIX = 'mk_live_';
const WEBHOOK_SECRET_PREFIX = 'whsec_';

export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function buildApiKey(workspaceId: string, clientId: string) {
  const secret = randomToken(24);
  const token = `${API_KEY_PREFIX}${workspaceId}.${clientId}.${secret}`;
  return {
    token,
    keyPrefix: secret.slice(0, 12),
    secretHash: hashSecret(secret),
  };
}

export function parseApiKey(token: string): { workspaceId: string; clientId: string; secret: string } | null {
  if (!token.startsWith(API_KEY_PREFIX)) return null;
  const raw = token.slice(API_KEY_PREFIX.length);
  const firstSep = raw.indexOf('.');
  const secondSep = raw.indexOf('.', firstSep + 1);
  if (firstSep <= 0 || secondSep <= firstSep + 1 || secondSep >= raw.length - 1) {
    return null;
  }

  const workspaceId = raw.slice(0, firstSep).trim();
  const clientId = raw.slice(firstSep + 1, secondSep).trim();
  const secret = raw.slice(secondSep + 1).trim();

  if (!workspaceId || !clientId || !secret) return null;
  return { workspaceId, clientId, secret };
}

export function buildWebhookSecret() {
  const secret = `${WEBHOOK_SECRET_PREFIX}${randomToken(24)}`;
  return {
    secret,
    secretHash: hashSecret(secret),
    secretEncrypted: encrypt(secret),
  };
}
