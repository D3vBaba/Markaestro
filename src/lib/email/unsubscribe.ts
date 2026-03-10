import crypto from 'crypto';

/**
 * Generate an HMAC-based unsubscribe token.
 * This lets us verify unsubscribe requests without storing tokens in the database.
 * Token = hex(HMAC-SHA256(ENCRYPTION_KEY, workspaceId:contactEmail))
 */
export function generateUnsubscribeToken(workspaceId: string, email: string): string {
  const key = process.env.ENCRYPTION_KEY || process.env.WORKER_SECRET || '';
  if (!key) throw new Error('ENCRYPTION_KEY is required for unsubscribe tokens');
  return crypto.createHmac('sha256', key).update(`${workspaceId}:${email}`).digest('hex');
}

/**
 * Verify an unsubscribe token matches the expected workspace + email combination.
 */
export function verifyUnsubscribeToken(workspaceId: string, email: string, token: string): boolean {
  const expected = generateUnsubscribeToken(workspaceId, email);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

/**
 * Build the full unsubscribe URL for a given contact.
 */
export function buildUnsubscribeUrl(workspaceId: string, email: string): string {
  const token = generateUnsubscribeToken(workspaceId, email);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const params = new URLSearchParams({ ws: workspaceId, email, token });
  return `${baseUrl}/api/email/unsubscribe?${params.toString()}`;
}
