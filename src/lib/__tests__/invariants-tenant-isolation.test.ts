/**
 * Invariants for cross-tenant isolation on the unauthenticated ingest paths.
 *
 * The property under test: a signed conversion request for workspace A must
 * never be able to write into workspace B, whatever the request body says.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  conversionSignature,
  verifyConversionRequest,
  workspaceIdFromIngestKeyId,
  workspaceIngestKeyId,
  workspaceIngestSecret,
} from '../intelligence/conversions';

const ROOT_SECRET = 'root-ingest-secret-for-tests';
const WORKSPACE_A = 'ws_alpha';
const WORKSPACE_B = 'ws_beta';

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.CONVERSION_INGEST_SECRET;
  process.env.CONVERSION_INGEST_SECRET = ROOT_SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CONVERSION_INGEST_SECRET;
  else process.env.CONVERSION_INGEST_SECRET = originalSecret;
});

function signFor(workspaceId: string, body: string): string {
  return conversionSignature(body, workspaceIngestSecret(workspaceId));
}

describe('per-workspace ingest key derivation', () => {
  it('derives a distinct secret per workspace', () => {
    expect(workspaceIngestSecret(WORKSPACE_A)).not.toBe(workspaceIngestSecret(WORKSPACE_B));
  });

  it('is deterministic for a given root secret and workspace', () => {
    expect(workspaceIngestSecret(WORKSPACE_A)).toBe(workspaceIngestSecret(WORKSPACE_A));
  });

  it('rotates every derived key when the root secret rotates', () => {
    const before = workspaceIngestSecret(WORKSPACE_A);
    process.env.CONVERSION_INGEST_SECRET = 'a-different-root';
    expect(workspaceIngestSecret(WORKSPACE_A)).not.toBe(before);
  });

  it('never returns the root secret itself', () => {
    expect(workspaceIngestSecret(WORKSPACE_A)).not.toBe(ROOT_SECRET);
  });

  it('refuses to derive when the root secret is unset', () => {
    delete process.env.CONVERSION_INGEST_SECRET;
    expect(() => workspaceIngestSecret(WORKSPACE_A)).toThrow('CONVERSION_INGEST_NOT_CONFIGURED');
  });

  it('round-trips a key id back to its workspace', () => {
    expect(workspaceIdFromIngestKeyId(workspaceIngestKeyId(WORKSPACE_A))).toBe(WORKSPACE_A);
  });

  it('rejects key ids that could escape the workspace path', () => {
    expect(workspaceIdFromIngestKeyId('mk_ci_')).toBeNull();
    expect(workspaceIdFromIngestKeyId('mk_ci_a/b')).toBeNull();
    expect(workspaceIdFromIngestKeyId(`mk_ci_${'x'.repeat(200)}`)).toBeNull();
    expect(workspaceIdFromIngestKeyId('not_a_key')).toBeNull();
    expect(workspaceIdFromIngestKeyId(null)).toBeNull();
  });
});

describe('conversion signature verification binds the workspace', () => {
  const body = JSON.stringify({ idempotencyId: 'evt_1', eventType: 'purchase', value: 99 });

  it('accepts a request signed with its own workspace key', () => {
    const result = verifyConversionRequest(body, signFor(WORKSPACE_A, body), workspaceIngestKeyId(WORKSPACE_A));
    expect(result).toEqual({ verified: true, scope: 'workspace', workspaceId: WORKSPACE_A });
  });

  it('takes the workspace from the key id, not from the body', () => {
    // The body claims workspace B; the signature is workspace A's. The verified
    // workspace must be A. The route then rejects the mismatch outright.
    const claimsB = JSON.stringify({ workspaceId: WORKSPACE_B, idempotencyId: 'evt_1' });
    const result = verifyConversionRequest(claimsB, signFor(WORKSPACE_A, claimsB), workspaceIngestKeyId(WORKSPACE_A));
    expect(result).toEqual({ verified: true, scope: 'workspace', workspaceId: WORKSPACE_A });
  });

  it('rejects workspace A’s signature presented under workspace B’s key id', () => {
    // This is the whole attack: one customer holding a valid key trying to
    // write into another customer's workspace.
    const result = verifyConversionRequest(body, signFor(WORKSPACE_A, body), workspaceIngestKeyId(WORKSPACE_B));
    expect(result).toEqual({ verified: false });
  });

  it('rejects a tampered body', () => {
    const signature = signFor(WORKSPACE_A, body);
    const tampered = JSON.stringify({ idempotencyId: 'evt_1', eventType: 'purchase', value: 99999 });
    expect(verifyConversionRequest(tampered, signature, workspaceIngestKeyId(WORKSPACE_A))).toEqual({ verified: false });
  });

  it('accepts a sha256= prefixed signature', () => {
    const result = verifyConversionRequest(
      body,
      `sha256=${signFor(WORKSPACE_A, body)}`,
      workspaceIngestKeyId(WORKSPACE_A),
    );
    expect(result.verified).toBe(true);
  });

  it('does not fall back to the global path when a key id is malformed', () => {
    // Otherwise an attacker could force a downgrade to the weaker global secret
    // just by sending a broken key id.
    const globalSignature = conversionSignature(body, ROOT_SECRET);
    expect(verifyConversionRequest(body, globalSignature, 'mk_ci_')).toEqual({ verified: false });
    expect(verifyConversionRequest(body, globalSignature, 'garbage')).toEqual({ verified: false });
  });

  it('still accepts the legacy global signature during the migration window', () => {
    const result = verifyConversionRequest(body, conversionSignature(body, ROOT_SECRET), null);
    expect(result).toEqual({ verified: true, scope: 'global', workspaceId: null });
  });

  it('rejects everything when no signature is supplied', () => {
    expect(verifyConversionRequest(body, null, workspaceIngestKeyId(WORKSPACE_A))).toEqual({ verified: false });
  });

  it('rejects everything when the root secret is unset', () => {
    delete process.env.CONVERSION_INGEST_SECRET;
    expect(verifyConversionRequest(body, 'anything', null)).toEqual({ verified: false });
  });
});
