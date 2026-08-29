/**
 * SSRF guard for customer-supplied webhook endpoint URLs.
 *
 * A webhook URL is attacker-controlled by design: any workspace admin, or any
 * API key holding `webhooks.manage`, chooses where Cloud Run sends a request.
 * Without a guard, `http://169.254.169.254/computeMetadata/v1/...` makes the
 * platform fetch its own instance metadata, and the per-attempt `responseCode`
 * we record is enough to port-scan the internal network even though response
 * bodies are never stored.
 *
 * The check runs twice, at registration and again immediately before each
 * delivery, because DNS can change in between: a hostname that resolved to a
 * public address at registration can resolve to `10.0.0.1` an hour later
 * (DNS rebinding). Registration-time validation alone is not a control.
 */

import { assertSafeOutboundUrl } from '@/lib/network-security';

/**
 * Local development commonly points a webhook at a tunnel or a local listener.
 * Production never gets this allowance.
 */
function allowsInsecureLocalTargets(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function webhookUrlProtocolIsAllowed(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  return parsed.protocol === 'http:' && allowsInsecureLocalTargets();
}

/**
 * Validate a webhook destination, throwing a coded error naming the rule that
 * failed so an admin testing against a staging host understands the rejection.
 *
 * Returns the parsed URL so callers can reuse it without re-parsing.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<URL> {
  if (!webhookUrlProtocolIsAllowed(rawUrl)) {
    throw new Error('VALIDATION_WEBHOOK_URL_MUST_BE_HTTPS');
  }

  // In development, a localhost or private target is the point, so skip the
  // network checks rather than special-casing every tunnel provider.
  if (allowsInsecureLocalTargets()) {
    try {
      return new URL(rawUrl);
    } catch {
      throw new Error('VALIDATION_WEBHOOK_URL_NOT_ALLOWED');
    }
  }

  try {
    return await assertSafeOutboundUrl(rawUrl, { httpsOnly: true });
  } catch {
    throw new Error('VALIDATION_WEBHOOK_URL_NOT_ALLOWED');
  }
}
