/**
 * User-visible errors are selected from application-owned copy only.
 *
 * API and provider payloads are diagnostic data, not presentation strings:
 * they can contain filenames, opaque identifiers, HTTP bodies, or sensitive
 * implementation details. Callers provide a localized fallback and may
 * explicitly map stable error codes to more actionable localized copy.
 */

type ErrorPayload = {
  code?: unknown;
  error?: unknown;
};

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,79}$/;

function asErrorCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  return ERROR_CODE_PATTERN.test(candidate) ? candidate : null;
}

/** Extract only a stable, machine-readable error code. Free text is ignored. */
export function getErrorCode(error: unknown): string | null {
  if (error instanceof Error) return asErrorCode(error.message);

  const direct = asErrorCode(error);
  if (direct) return direct;

  if (!error || typeof error !== 'object') return null;
  const payload = error as ErrorPayload;
  return asErrorCode(payload.code) ?? asErrorCode(payload.error);
}

/**
 * Resolve safe UI copy without ever returning raw exception/API/provider text.
 */
export function userFacingError(
  error: unknown,
  fallback: string,
  messages: Readonly<Record<string, string>> = {},
): string {
  const code = getErrorCode(error);
  if (!code) return fallback;
  return Object.prototype.hasOwnProperty.call(messages, code)
    ? messages[code]
    : fallback;
}

