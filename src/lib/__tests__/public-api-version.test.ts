import { describe, expect, it } from 'vitest';
import {
  API_VERSIONS,
  CURRENT_API_VERSION,
  MIN_DEPRECATION_WINDOW_DAYS,
  OLDEST_SUPPORTED_API_VERSION,
  VERSION_COMPATIBILITY_POLICY,
  atLeastVersion,
  deprecationHeaders,
  resolveApiVersion,
  sunsetWindowIsValid,
  versionForDate,
} from '@/lib/public-api/version';

/**
 * There were two versioned prefixes and no written rule about what could
 * change inside them. By the time a change is contentious there are
 * third-party clients depending on current behaviour and no agreement about
 * what they were entitled to assume, so the policy has to exist before the
 * first change that needs it, not after.
 */

describe('dated API versions', () => {
  it('pins a key to the version current when it was created', () => {
    // An integration nobody maintains keeps working. That is the entire point
    // of dating the version rather than always serving the newest behaviour.
    expect(versionForDate('2026-02-14T10:00:00.000Z')).toBe('2026-01-01');
    expect(versionForDate('2026-08-29T00:00:00.000Z')).toBe('2026-08-29');
    expect(versionForDate('2026-12-31T00:00:00.000Z')).toBe(CURRENT_API_VERSION);
  });

  it('falls back to the oldest supported version for a key with no creation date', () => {
    expect(versionForDate(null)).toBe(OLDEST_SUPPORTED_API_VERSION);
    expect(versionForDate('not-a-date')).toBe(OLDEST_SUPPORTED_API_VERSION);
  });

  it('lets a client opt into a version with a header', () => {
    const headers = new Headers({ 'markaestro-version': '2026-08-29' });
    expect(resolveApiVersion(headers, '2026-01-05')).toBe('2026-08-29');
  });

  it('refuses an unknown version rather than quietly serving an older one', () => {
    // A client that asks for 2027-01-01 and silently gets 2026 behaviour has
    // no way to notice it did not get what it asked for.
    const headers = new Headers({ 'markaestro-version': '2027-01-01' });
    expect(() => resolveApiVersion(headers, null)).toThrow('VALIDATION_UNKNOWN_API_VERSION');
  });

  it('orders versions so a comparison means what it reads like', () => {
    expect(atLeastVersion('2026-08-29', '2026-01-01')).toBe(true);
    expect(atLeastVersion('2026-01-01', '2026-08-29')).toBe(false);
  });

  it('keeps the version list sorted oldest first', () => {
    const versions = API_VERSIONS.map((entry) => entry.version);
    expect([...versions]).toEqual([...versions].sort());
    expect(CURRENT_API_VERSION).toBe(versions[versions.length - 1]);
  });
});

describe('deprecation', () => {
  it('emits RFC 8594 Sunset alongside Deprecation', () => {
    const headers = deprecationHeaders({
      deprecatedAt: '2026-09-01T00:00:00.000Z',
      sunsetAt: '2027-04-01T00:00:00.000Z',
      changelogUrl: 'https://markaestro.com/developers/api#changelog',
    });
    expect(headers.Deprecation).toContain('2026');
    expect(headers.Sunset).toContain('2027');
    expect(headers.Link).toContain('rel="deprecation"');
  });

  it('holds the policy to its own six month minimum', () => {
    // The window is what makes per-key usage telemetry worth having: you can
    // mail the few keys still calling an endpoint instead of announcing
    // broadly and hoping.
    expect(sunsetWindowIsValid('2026-09-01T00:00:00.000Z', '2027-04-01T00:00:00.000Z')).toBe(true);
    expect(sunsetWindowIsValid('2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')).toBe(false);
    expect(MIN_DEPRECATION_WINDOW_DAYS).toBeGreaterThanOrEqual(183);
  });

  it('treats an unparseable window as invalid rather than permissible', () => {
    expect(sunsetWindowIsValid('nope', '2027-04-01T00:00:00.000Z')).toBe(false);
  });
});

describe('the compatibility policy', () => {
  it('classifies every kind of change into exactly one bucket', () => {
    const all = [
      ...VERSION_COMPATIBILITY_POLICY.allowedInPlace,
      ...VERSION_COMPATIBILITY_POLICY.requiresDatedVersion,
      ...VERSION_COMPATIBILITY_POLICY.requiresNewPathVersion,
    ];
    expect(new Set(all).size).toBe(all.length);
    expect(VERSION_COMPATIBILITY_POLICY.allowedInPlace.length).toBeGreaterThan(0);
    expect(VERSION_COMPATIBILITY_POLICY.requiresNewPathVersion.length).toBeGreaterThan(0);
  });
});
