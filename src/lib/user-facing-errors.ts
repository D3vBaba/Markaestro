/**
 * User-visible errors are selected from application-owned copy only.
 *
 * API and provider payloads are diagnostic data, not presentation strings:
 * they can contain filenames, opaque identifiers, HTTP bodies, or sensitive
 * implementation details. Callers provide a localized fallback and may
 * explicitly map stable error codes to more actionable localized copy.
 *
 * The one exception is `userMessage`, which `apiError()` sets only from copy
 * written in this repository (see `authoredError` in lib/api-response.ts).
 * That field exists precisely so the server can say "Instagram allows a
 * maximum of 10 media items per post. This post has 12" instead of having
 * that sentence thrown away at the boundary and replaced with "Failed to
 * schedule post". `message`, `error`, and everything else in the payload stay
 * unrenderable.
 */

type ErrorPayload = {
  code?: unknown;
  error?: unknown;
  userMessage?: unknown;
  issues?: unknown;
};

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,79}$/;

/**
 * A rendered server message is one sentence or two, not a stack trace or an
 * HTML error page that happened to land in the field. Anything longer is
 * treated as not-copy and falls through to the caller's fallback.
 */
const MAX_USER_MESSAGE_LENGTH = 400;

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
 * The server-authored sentence for this failure, when there is one.
 *
 * Only reads `userMessage`, never `message`: routes that proxy a provider
 * response can put provider text in `message`, and `apiError`'s unknown-error
 * branch never populates `userMessage` at all.
 */
export function getServerAuthoredMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const { userMessage } = error as ErrorPayload;
  if (typeof userMessage !== 'string') return null;
  const trimmed = userMessage.trim();
  if (!trimmed || trimmed.length > MAX_USER_MESSAGE_LENGTH) return null;
  // A bare error code is a code, not copy; the code map handles those.
  if (ERROR_CODE_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function validationIssueField(issue: unknown): string {
  if (!issue || typeof issue !== 'object') return '';
  const field = (issue as { field?: unknown }).field;
  return typeof field === 'string' ? field : '';
}

function validationIssueMessage(issue: unknown): string {
  if (!issue || typeof issue !== 'object') return '';
  const record = issue as { message?: unknown; channel?: unknown };
  const message = typeof record.message === 'string' ? record.message.trim() : '';
  if (!message || message.length > MAX_USER_MESSAGE_LENGTH) return '';
  return message;
}

/** Field paths from a VALIDATION_ERROR payload. Empty when the payload is not one. */
export function getValidationIssueFields(error: unknown): string[] {
  if (!error || typeof error !== 'object') return [];
  if (getErrorCode(error) !== 'VALIDATION_ERROR') return [];
  const { issues } = error as ErrorPayload;
  if (!Array.isArray(issues)) return [];
  return issues.map(validationIssueField).filter(Boolean);
}

/**
 * Per-issue copy from a validation payload.
 *
 * A multi-channel post can fail for two unrelated reasons at once ("Instagram
 * is not ready: token expired", "LinkedIn allows a maximum of 9 images"), and
 * collapsing those into one toast is how the composer used to lose both. The
 * caller renders these as a list.
 *
 * Server-authored issue text only: every producer of `issues[]` is our own
 * code (`publicValidationIssueMessage`, preflight issues), so the same
 * reasoning as `userMessage` applies.
 */
export function userFacingIssues(error: unknown): string[] {
  if (!error || typeof error !== 'object') return [];
  const { issues } = error as ErrorPayload;
  if (!Array.isArray(issues)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const issue of issues) {
    const message = validationIssueMessage(issue);
    if (!message || seen.has(message)) continue;
    seen.add(message);
    out.push(message);
  }
  return out;
}

/**
 * Transport-level failures, which no individual screen writes copy for.
 *
 * `MALFORMED_RESPONSE` and `INTERNAL_ERROR` are what `apiFetch` synthesises
 * when a body will not parse (a Cloud Run 502, an HTML 500 page, a
 * load-balancer error), so they can surface on any call in the app. Without
 * an entry here every one of them renders as the calling screen's generic
 * fallback, which is how "the deploy is broken" and "that title is too long"
 * came to look identical.
 *
 * English defaults; `setCommonErrorMessages` swaps in the active locale's
 * copy once the app shell mounts.
 */
const DEFAULT_COMMON_ERROR_MESSAGES: Record<string, string> = {
  MALFORMED_RESPONSE: 'The server sent a response we could not read. Please try again.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
  REQUEST_TIMEOUT: 'The request timed out. Please try again.',
};

let commonErrorMessages: Readonly<Record<string, string>> = DEFAULT_COMMON_ERROR_MESSAGES;

/** Register localized copy for the transport-level codes. */
export function setCommonErrorMessages(messages: Readonly<Record<string, string>>): void {
  commonErrorMessages = { ...DEFAULT_COMMON_ERROR_MESSAGES, ...messages };
}

/** Test seam: restore the built-in English defaults. */
export function resetCommonErrorMessages(): void {
  commonErrorMessages = DEFAULT_COMMON_ERROR_MESSAGES;
}

/**
 * Resolve safe UI copy without ever returning raw exception/API/provider text.
 *
 * Precedence, most specific first:
 *   1. an explicit code → localized copy mapping from the caller,
 *   2. the server's own `userMessage`,
 *   3. localized copy for a transport-level code,
 *   4. the caller's localized fallback.
 *
 * The caller's map outranks `userMessage` so a screen that has written
 * localized copy for a code keeps it; `userMessage` is English by design and
 * exists to cover the dynamic cases no map can enumerate.
 */
export function userFacingError(
  error: unknown,
  fallback: string,
  messages: Readonly<Record<string, string>> = {},
): string {
  const code = getErrorCode(error);
  if (code && Object.prototype.hasOwnProperty.call(messages, code)) {
    return messages[code];
  }
  const authored = getServerAuthoredMessage(error);
  if (authored) return authored;
  if (code && Object.prototype.hasOwnProperty.call(commonErrorMessages, code)) {
    return commonErrorMessages[code];
  }
  return fallback;
}

/**
 * The request id the server (or the client) stamped on this failure.
 *
 * Shown alongside an error so a support conversation starts with a string
 * that finds every log line for the request, rather than a timestamp and a
 * screen name.
 */
export function getRequestId(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as { requestId?: unknown }).requestId;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(trimmed) ? trimmed : null;
}
