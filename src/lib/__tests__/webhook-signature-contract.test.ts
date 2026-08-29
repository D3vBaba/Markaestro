import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The webhook signature is the one part of this API an integrator has to
 * reimplement, in a language we did not write, from prose. If the prose is
 * wrong they get a verification that rejects every delivery, and the failure
 * looks like our bug from where they are standing.
 *
 * So the documented construction is tested here against the same HMAC the
 * deliverer computes. The Node snippet in `docs/PUBLIC_API.md` is executed
 * verbatim rather than paraphrased: a snippet nobody runs is a snippet that
 * drifts.
 */

const SECRET = 'whsec_test_secret';
const PREVIOUS_SECRET = 'whsec_previous_secret';

/** Mirrors `signPayload` in webhook-delivery.ts. */
function sign(secret: string, timestamp: string, body: string) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** The documented Node verifier, transcribed from docs/PUBLIC_API.md. */
function verify(rawBody: string, headers: Record<string, string | undefined>, secret: string) {
  const timestamp = headers['x-markaestro-timestamp'];
  if (!timestamp) return false;

  const age = Date.now() - Date.parse(timestamp);
  if (!Number.isFinite(age) || age > 5 * 60_000) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  return [headers['x-markaestro-signature'], headers['x-markaestro-signature-previous']]
    .filter((value): value is string => Boolean(value))
    .some((candidate) => {
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(candidate, 'utf8');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
}

function delivery(body: string, timestamp = new Date().toISOString()) {
  return {
    body,
    headers: {
      'x-markaestro-timestamp': timestamp,
      'x-markaestro-signature': sign(SECRET, timestamp, body),
    } as Record<string, string | undefined>,
  };
}

describe('the documented webhook verification', () => {
  it('accepts a genuine delivery', () => {
    const { body, headers } = delivery(JSON.stringify({ type: 'post.published', id: 'p1' }));
    expect(verify(body, headers, SECRET)).toBe(true);
  });

  it('rejects a delivery signed with a different secret', () => {
    const { body, headers } = delivery('{"type":"post.published"}');
    expect(verify(body, headers, 'whsec_wrong')).toBe(false);
  });

  it('rejects a body that was altered after signing', () => {
    const { headers } = delivery('{"type":"post.published","value":1}');
    expect(verify('{"type":"post.published","value":999}', headers, SECRET)).toBe(false);
  });

  it('rejects a replay outside the five minute window', () => {
    // Without this a captured payload can be replayed forever.
    const old = new Date(Date.now() - 6 * 60_000).toISOString();
    const { body, headers } = delivery('{"type":"post.published"}', old);
    expect(verify(body, headers, SECRET)).toBe(false);
  });

  it('rejects a delivery with no timestamp, rather than signing the empty string', () => {
    const { body, headers } = delivery('{"type":"post.published"}');
    delete headers['x-markaestro-timestamp'];
    expect(verify(body, headers, SECRET)).toBe(false);
  });

  it('accepts either signature during a rotation grace window', () => {
    // This is what lets a receiver redeploy at its own pace instead of having
    // a rotation break delivery until it does.
    const timestamp = new Date().toISOString();
    const body = '{"type":"post.published"}';
    const headers = {
      'x-markaestro-timestamp': timestamp,
      'x-markaestro-signature': sign(SECRET, timestamp, body),
      'x-markaestro-signature-previous': sign(PREVIOUS_SECRET, timestamp, body),
    };
    expect(verify(body, headers, SECRET)).toBe(true);
    // The receiver that has not redeployed yet still verifies.
    expect(verify(body, headers, PREVIOUS_SECRET)).toBe(true);
  });

  it('signs the raw body, so a re-serialized object does not verify', () => {
    // The most common integration mistake: parse, re-stringify, then sign.
    // Whitespace and number formatting both change on the round trip.
    const raw = '{"value": 1.50, "ok": true}';
    const { headers } = delivery(raw);
    const reserialized = JSON.stringify(JSON.parse(raw));
    expect(reserialized).not.toBe(raw);
    expect(verify(reserialized, headers, SECRET)).toBe(false);
    expect(verify(raw, headers, SECRET)).toBe(true);
  });
});

describe('the documentation itself', () => {
  it('documents every header the deliverer actually sends', () => {
    const deliverer = readFileSync(
      join(process.cwd(), 'src', 'lib', 'public-api', 'webhook-delivery.ts'),
      'utf8',
    );
    const docs = readFileSync(join(process.cwd(), 'docs', 'PUBLIC_API.md'), 'utf8');
    const sent = [...deliverer.matchAll(/'(X-Markaestro-[A-Za-z-]+)'/g)].map((match) => match[1]);
    expect(sent.length).toBeGreaterThan(0);
    for (const header of new Set(sent)) {
      expect(docs, `${header} is sent but not documented`).toContain(header);
    }
  });

  it('states the signed string in the order the code signs it', () => {
    const docs = readFileSync(join(process.cwd(), 'docs', 'PUBLIC_API.md'), 'utf8');
    expect(docs).toContain('<X-Markaestro-Timestamp> + "." + <raw body bytes>');
  });
});
