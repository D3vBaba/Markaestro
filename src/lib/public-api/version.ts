/**
 * What may change inside `/api/public/v1` and `/api/connect/v1`, and how a
 * behaviour change ships without a v2.
 *
 * The prefixes existed before the policy did, which is the usual order and the
 * usual problem: by the time a change is contentious there are third-party
 * clients depending on the current behaviour, and no written rule about what
 * they were entitled to assume. This module is that rule, in code, so the
 * pieces that need to be enforced (which version a request runs under, what a
 * deprecation announces) are not prose in a markdown file.
 *
 * The model is Stripe's: one long-lived path version, and dated sub-versions
 * for behaviour changes. A key pins to the dated version current when it was
 * created, so an integration that stops being maintained keeps working, and a
 * client that wants new behaviour opts in with a header rather than waiting
 * for a v2 that would break everyone at once.
 */

/**
 * Every dated version, oldest first.
 *
 * A new entry is added only for a change the compatibility rules below forbid
 * making silently. Additive changes (a new optional request field, a new
 * response field, a new endpoint) do not get an entry, because they do not
 * need one: they cannot break a client that is not looking for them.
 */
export const API_VERSIONS = [
  {
    version: '2026-01-01',
    summary: 'The original v1 behaviour, and the default for every key created before dated versioning.',
  },
  {
    version: '2026-08-29',
    summary:
      'Errors carry a `userMessage` field with server-authored copy, and every code is enumerated in the error catalogue.',
  },
] as const;

export type ApiVersion = (typeof API_VERSIONS)[number]['version'];

/** The newest dated version. New keys default to it. */
export const CURRENT_API_VERSION: ApiVersion = API_VERSIONS[API_VERSIONS.length - 1].version;

/** The oldest version still served. Anything older is pinned up to this. */
export const OLDEST_SUPPORTED_API_VERSION: ApiVersion = API_VERSIONS[0].version;

/** The header a client sends to run under a specific dated version. */
export const API_VERSION_HEADER = 'markaestro-version';

/** The header every response carries, naming the version it actually ran under. */
export const API_VERSION_RESPONSE_HEADER = 'Markaestro-Version';

const VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isKnownVersion(value: string): value is ApiVersion {
  return API_VERSIONS.some((entry) => entry.version === value);
}

/**
 * The version a date falls under: the newest dated version at or before it.
 *
 * A key created between two versions runs under the older one, which is the
 * behaviour that existed when its author wrote their integration.
 */
export function versionForDate(createdAt: string | null | undefined): ApiVersion {
  if (!createdAt) return OLDEST_SUPPORTED_API_VERSION;
  const stamp = createdAt.slice(0, 10);
  if (!VERSION_PATTERN.test(stamp)) return OLDEST_SUPPORTED_API_VERSION;
  let resolved: ApiVersion = OLDEST_SUPPORTED_API_VERSION;
  for (const entry of API_VERSIONS) {
    if (entry.version <= stamp) resolved = entry.version;
  }
  return resolved;
}

/**
 * The version this request runs under.
 *
 * Precedence: an explicit header, then the key's pinned version, then the
 * oldest supported. An unrecognised header value is an error rather than a
 * silent fallback, because a client that asks for `2027-01-01` and quietly
 * gets 2026 behaviour has no way to notice.
 */
export function resolveApiVersion(
  headers: Headers,
  keyCreatedAt?: string | null,
): ApiVersion {
  const requested = headers.get(API_VERSION_HEADER)?.trim();
  if (requested) {
    if (!isKnownVersion(requested)) {
      throw new Error('VALIDATION_UNKNOWN_API_VERSION');
    }
    return requested;
  }
  return versionForDate(keyCreatedAt);
}

/** Whether the request runs at or after a given dated version. */
export function atLeastVersion(current: ApiVersion, target: ApiVersion): boolean {
  return current >= target;
}

/**
 * Deprecation headers for an endpoint or field being retired.
 *
 * RFC 8594 `Sunset` plus the `Deprecation` header, and a `Link` to the
 * changelog entry that explains it. The minimum window is six months from the
 * announcement, which is what makes per-key usage telemetry worth having: you
 * can mail the handful of keys still calling the endpoint instead of
 * announcing broadly and hoping.
 */
export const MIN_DEPRECATION_WINDOW_DAYS = 183;

export function deprecationHeaders(input: {
  /** When the deprecation was announced, ISO 8601. */
  deprecatedAt: string;
  /** When the endpoint stops answering, ISO 8601. At least six months later. */
  sunsetAt: string;
  /** Where the change is written up. */
  changelogUrl?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Deprecation: new Date(input.deprecatedAt).toUTCString(),
    Sunset: new Date(input.sunsetAt).toUTCString(),
  };
  if (input.changelogUrl) {
    headers.Link = `<${input.changelogUrl}>; rel="deprecation"; type="text/html"`;
  }
  return headers;
}

/**
 * Whether a proposed sunset honours the minimum window. Exported so the tests
 * can hold the policy to its own number rather than trusting a comment.
 */
export function sunsetWindowIsValid(deprecatedAt: string, sunsetAt: string): boolean {
  const from = new Date(deprecatedAt).getTime();
  const to = new Date(sunsetAt).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  return to - from >= MIN_DEPRECATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Changes that may ship inside a path version without a dated version, and
 * changes that may not.
 *
 * Kept here rather than only in the docs so the generator can render one list
 * and the docs cannot drift from it.
 */
export const VERSION_COMPATIBILITY_POLICY = {
  allowedInPlace: [
    'Adding a new endpoint.',
    'Adding an optional request field.',
    'Adding a field to a response.',
    'Relaxing a validation rule so previously rejected requests now succeed.',
    'Adding a new value to an enum that only ever appears in responses.',
  ],
  requiresDatedVersion: [
    'Changing a default when a field is omitted.',
    'Changing the shape or type of an existing response field.',
    'Adding a value to an enum a client sends, where old servers would reject it.',
  ],
  requiresNewPathVersion: [
    'Removing or renaming a request or response field.',
    'Tightening validation so previously accepted requests now fail.',
    'Changing the status code an existing condition returns.',
    'Changing what an endpoint does to the underlying resource.',
  ],
} as const;
