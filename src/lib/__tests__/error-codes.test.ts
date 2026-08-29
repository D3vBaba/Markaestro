import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ERROR_CODES,
  isRetryableErrorCode,
  listErrorCodes,
  resolveErrorCode,
} from '@/lib/error-codes';
import { socialChannels } from '@/lib/schemas';

/**
 * The catalogue's whole value is that it is complete. A code thrown but not
 * catalogued still works, it is simply invisible to the docs and to the
 * OpenAPI spec, which is the state every code was in before this file existed.
 *
 * So the load-bearing test is not "the registry parses", it is "the registry
 * covers what the codebase actually throws". That is what turns a documented
 * error surface into one that stays documented.
 */

const ROOT = join(process.cwd(), 'src');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      yield* walk(path);
    } else if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      yield path;
    }
  }
}

/**
 * Codes the server raises for itself rather than for a caller: they never
 * reach an API response, so cataloguing them would document something an
 * integrator cannot receive. Each entry is a deliberate exclusion.
 */
const NOT_CALLER_FACING = new Set([
  // Node's own DNS retry signal, caught and classified, never thrown at a caller.
  'EAI_AGAIN',
  // api-client.ts (browser code): the unreachable end of the retry loop,
  // kept to satisfy the compiler. It is thrown in the user's browser, never
  // returned by the API.
  'REQUEST_FAILED',
]);

function thrownErrorCodes(): Set<string> {
  const codes = new Set<string>();
  const patterns = [
    /new Error\('([A-Z][A-Z0-9_]{2,79})'\)/g,
    /new ApiValidationError\(\s*'([A-Z][A-Z0-9_]{2,79})'/g,
  ];
  for (const file of walk(ROOT)) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) codes.add(match[1]);
    }
  }
  return codes;
}

describe('the error catalogue', () => {
  it('covers every error code the codebase throws', () => {
    const uncatalogued = [...thrownErrorCodes()]
      .filter((code) => !NOT_CALLER_FACING.has(code))
      .filter((code) => !resolveErrorCode(code))
      .sort();

    // Adding a code to the registry is what makes it documented. If this
    // fails, add the code to `ERROR_CODES` (or to NOT_CALLER_FACING with a
    // reason) rather than deleting the assertion.
    expect(uncatalogued).toEqual([]);
  });

  it('generates the channel-specific codes rather than listing them six times', () => {
    for (const channel of socialChannels) {
      expect(resolveErrorCode(`VALIDATION_${channel.toUpperCase()}_NOT_READY`)).not.toBeNull();
    }
    // Generated codes are absent from the hand-written table by construction.
    expect(ERROR_CODES.VALIDATION_INSTAGRAM_NOT_READY).toBeUndefined();
  });

  it('returns null for an unknown code instead of guessing a status', () => {
    // Conflating "we know this is a 400" with "it starts with VALIDATION_ so
    // it is probably a 400" would hide exactly the codes worth adding.
    expect(resolveErrorCode('VALIDATION_SOMETHING_NOBODY_CATALOGUED')).toBeNull();
    expect(isRetryableErrorCode('VALIDATION_SOMETHING_NOBODY_CATALOGUED')).toBe(false);
  });

  it('is byte-stable, so a regenerated spec diffs cleanly', () => {
    const once = listErrorCodes().map((record) => record.code);
    const twice = listErrorCodes().map((record) => record.code);
    expect(once).toEqual(twice);
    expect([...once]).toEqual([...once].sort((a, b) => {
      const left = resolveErrorCode(a)!;
      const right = resolveErrorCode(b)!;
      return left.status - right.status || a.localeCompare(b);
    }));
  });

  it('gives every entry a status, a category, and a description', () => {
    for (const record of listErrorCodes()) {
      expect(record.status).toBeGreaterThanOrEqual(400);
      expect(record.status).toBeLessThan(600);
      expect(record.description.length).toBeGreaterThan(10);
      expect(typeof record.retryable).toBe('boolean');
    }
  });

  it('marks the model backend failures retryable, because the operation is refunded', () => {
    // An SDK needs to know the difference between "back off and try again" and
    // "change something first". A refunded Vertex 503 is the former.
    expect(isRetryableErrorCode('VERTEX_UNAVAILABLE')).toBe(true);
    expect(isRetryableErrorCode('VERTEX_AI_NOT_CONFIGURED')).toBe(false);
    expect(isRetryableErrorCode('VALIDATION_ERROR')).toBe(false);
  });
});
