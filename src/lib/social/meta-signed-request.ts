import crypto from 'node:crypto';

/**
 * Meta platform products that fire deauthorize / data-deletion callbacks.
 * Each is registered against the same Meta app family but signs its
 * signed_request with its own app secret.
 */
export type MetaProvider = 'meta' | 'instagram' | 'threads';

export type MetaSignedRequestPayload = {
  user_id?: string;
  algorithm?: string;
  issued_at?: number;
  [key: string]: unknown;
};

export type MetaSecret = { provider: MetaProvider; secret: string };

export type MetaSignedRequestResult =
  | { ok: true; provider: MetaProvider; payload: MetaSignedRequestPayload }
  | {
      ok: false;
      reason:
        | 'missing'
        | 'no_secrets'
        | 'malformed'
        | 'unsupported_algorithm'
        | 'bad_signature';
    };

/**
 * Meta delivers the signed_request either as a form field
 * (`signed_request=<sig>.<payload>`, the default for these callbacks) or, on
 * some deliveries, as the raw body. Normalise both to the bare token.
 */
export function extractSignedRequest(rawBody: string): string | null {
  if (!rawBody) return null;
  if (rawBody.includes('signed_request=')) {
    const fromForm = new URLSearchParams(rawBody).get('signed_request');
    if (fromForm) return fromForm;
  }
  // A bare signed_request is always "<sig>.<payload>".
  return rawBody.includes('.') ? rawBody.trim() : null;
}

/**
 * Build the candidate secret list from the environment. Trimmed for the same
 * reason getClientCredentials trims — secrets uploaded via `echo` carry a
 * trailing newline that would corrupt the HMAC comparison.
 */
export function metaSecretsFromEnv(): MetaSecret[] {
  const candidates: Array<[MetaProvider, string | undefined]> = [
    ['meta', process.env.META_APP_SECRET],
    ['instagram', process.env.INSTAGRAM_APP_SECRET],
    ['threads', process.env.THREADS_APP_SECRET],
  ];
  return candidates
    .map(([provider, raw]) => ({ provider, secret: (raw || '').trim() }))
    .filter((entry): entry is MetaSecret => entry.secret.length > 0);
}

/**
 * Verify a Meta signed_request against any of the supplied app secrets.
 *
 * The signature is an HMAC-SHA256 of the base64url payload string (NOT the
 * decoded JSON) keyed by the app secret, itself base64url-encoded. We try each
 * provider's secret so a single endpoint can serve meta, instagram and threads
 * callbacks, and report which provider matched so the caller can scope the
 * deletion to the right identifier.
 */
export function verifyMetaSignedRequest(
  signedRequest: string | null,
  secrets: MetaSecret[],
): MetaSignedRequestResult {
  if (!signedRequest) return { ok: false, reason: 'missing' };
  if (secrets.length === 0) return { ok: false, reason: 'no_secrets' };

  const dot = signedRequest.indexOf('.');
  if (dot <= 0 || dot === signedRequest.length - 1) {
    return { ok: false, reason: 'malformed' };
  }

  const encodedSig = signedRequest.slice(0, dot);
  const encodedPayload = signedRequest.slice(dot + 1);

  let providedSig: Buffer;
  let payload: MetaSignedRequestPayload;
  try {
    providedSig = Buffer.from(encodedSig, 'base64url');
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (providedSig.length === 0) return { ok: false, reason: 'malformed' };

  // Meta only ever signs these callbacks with HMAC-SHA256.
  if (
    payload.algorithm &&
    String(payload.algorithm).toUpperCase().replace('-', '') !== 'HMACSHA256'
  ) {
    return { ok: false, reason: 'unsupported_algorithm' };
  }

  for (const { provider, secret } of secrets) {
    const expected = crypto.createHmac('sha256', secret).update(encodedPayload).digest();
    if (
      expected.length === providedSig.length &&
      crypto.timingSafeEqual(expected, providedSig)
    ) {
      return { ok: true, provider, payload };
    }
  }

  return { ok: false, reason: 'bad_signature' };
}
