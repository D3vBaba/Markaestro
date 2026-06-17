import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  extractSignedRequest,
  verifyMetaSignedRequest,
  type MetaSecret,
} from './meta-signed-request';

const META: MetaSecret = { provider: 'meta', secret: 'meta_secret' };
const IG: MetaSecret = { provider: 'instagram', secret: 'ig_secret' };
const TH: MetaSecret = { provider: 'threads', secret: 'threads_secret' };

function sign(payload: object, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${sig}.${encodedPayload}`;
}

describe('verifyMetaSignedRequest', () => {
  const payload = { user_id: 'u_123', algorithm: 'HMAC-SHA256', issued_at: 1_700_000_000 };

  it('verifies a request signed with the meta secret and reports the provider', () => {
    const res = verifyMetaSignedRequest(sign(payload, META.secret), [META, IG, TH]);
    expect(res).toMatchObject({ ok: true, provider: 'meta' });
    if (res.ok) expect(res.payload.user_id).toBe('u_123');
  });

  it('matches the correct provider when multiple secrets are configured', () => {
    const res = verifyMetaSignedRequest(sign(payload, TH.secret), [META, IG, TH]);
    expect(res).toMatchObject({ ok: true, provider: 'threads' });
  });

  it('rejects a tampered payload', () => {
    const valid = sign(payload, META.secret);
    const [sig] = valid.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ user_id: 'attacker' })).toString('base64url');
    const res = verifyMetaSignedRequest(`${sig}.${forgedPayload}`, [META, IG, TH]);
    expect(res).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects when no secret matches', () => {
    const res = verifyMetaSignedRequest(sign(payload, 'wrong_secret'), [META, IG, TH]);
    expect(res).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a malformed token', () => {
    expect(verifyMetaSignedRequest('not-a-signed-request', [META])).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects an unsupported algorithm', () => {
    const res = verifyMetaSignedRequest(
      sign({ user_id: 'u', algorithm: 'PLAINTEXT' }, META.secret),
      [META],
    );
    expect(res).toEqual({ ok: false, reason: 'unsupported_algorithm' });
  });

  it('reports missing input and missing secrets distinctly', () => {
    expect(verifyMetaSignedRequest(null, [META])).toEqual({ ok: false, reason: 'missing' });
    expect(verifyMetaSignedRequest(sign(payload, META.secret), [])).toEqual({
      ok: false,
      reason: 'no_secrets',
    });
  });
});

describe('extractSignedRequest', () => {
  it('pulls signed_request out of a form-encoded body', () => {
    const token = sign({ user_id: 'u' }, META.secret);
    expect(extractSignedRequest(`signed_request=${encodeURIComponent(token)}`)).toBe(token);
  });

  it('accepts a bare signed_request body', () => {
    const token = sign({ user_id: 'u' }, META.secret);
    expect(extractSignedRequest(token)).toBe(token);
  });

  it('returns null for an empty or non-token body', () => {
    expect(extractSignedRequest('')).toBeNull();
    expect(extractSignedRequest('garbage')).toBeNull();
  });
});
