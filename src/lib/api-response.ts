import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import * as Sentry from '@sentry/nextjs';
import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/request-context';

export function publicValidationIssueMessage(code: string): string {
  switch (code) {
    case 'too_small':
      return 'This value is required or below the minimum.';
    case 'too_big':
      return 'This value exceeds the allowed maximum.';
    case 'unrecognized_keys':
      return 'One or more fields are not supported.';
    default:
      return 'This value is invalid.';
  }
}

/**
 * A validation failure that carries a human-readable explanation and the
 * machine-readable facts behind it (which field, which channel, what limit).
 *
 * A bare `throw new Error('VALIDATION_TOO_MANY_MEDIA_ASSETS')` maps to a 400
 * whose body is the code and nothing else, which leaves the caller guessing
 * at the actual ceiling. Throw this instead whenever the limit is dynamic
 * (per channel, per plan, per surface) so the response can state it.
 */
export class ApiValidationError extends Error {
  readonly userMessage: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, userMessage: string, details: Record<string, unknown> = {}) {
    super(code);
    this.name = 'ApiValidationError';
    this.userMessage = userMessage;
    this.details = details;
  }
}

/**
 * Copy the application authored, safe to render verbatim in the UI.
 *
 * `error` is a machine code, `message` is legacy and shared with routes that
 * proxy provider payloads, and neither is a safe render target on its own.
 * `userMessage` is set ONLY here and only from strings in this repository, so
 * `userFacingError()` on the client can render it without the risk that made
 * it discard `message` in the first place: provider text, filenames, opaque
 * ids, and raw HTTP bodies can never reach this field. The unknown-error
 * branch at the bottom of `apiError` deliberately never sets it.
 */
export function authoredError(
  code: string,
  userMessage: string,
  init: { status: number; details?: Record<string, unknown> },
): NextResponse {
  return NextResponse.json(
    {
      error: code,
      // `message` is kept for existing API consumers; `userMessage` is the
      // field the UI reads.
      message: userMessage,
      userMessage,
      ...(init.details || {}),
      requestId: currentRequestId(),
    },
    { status: init.status },
  );
}

/**
 * The id the edge minted for this request, so the value in a user's error
 * toast matches every log line the request emitted. Falls back to a fresh id
 * only outside a request (direct unit-test calls, background work).
 */
function currentRequestId(): string {
  return getRequestId() ?? crypto.randomUUID();
}

/**
 * Centralized API error → HTTP response mapper.
 * Handles Zod validation errors, known error codes, and unknown errors.
 */
export function apiError(error: unknown): NextResponse {
  // Helpers such as applyRateLimit intentionally throw a fully-formed 429.
  // Preserve it instead of converting it into a generic 500 response.
  if (error instanceof Response) return error as NextResponse;

  const requestId = currentRequestId();

  // Zod validation errors → 400 with field-level details
  if (error instanceof ZodError) {
    const issues = error.issues.map((i) => ({
      field: i.path.join('.'),
      code: i.code,
      message: publicValidationIssueMessage(i.code),
    }));
    // Field paths and Zod issue codes only — never the free-text message,
    // which can echo back arbitrary request content. This is what let a
    // stale-channel 400 go unexplained: the field it failed on wasn't
    // visible anywhere without asking the reporting user to inspect the
    // network tab themselves.
    logger.warn('request failed schema validation', {
      event: 'api.validation_error',
      requestId,
      fields: error.issues.map((i) => i.path.join('.')),
      codes: error.issues.map((i) => i.code),
    });
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues, requestId },
      { status: 400 },
    );
  }

  // Structured validation errors carry their own message and details.
  if (error instanceof ApiValidationError) {
    return authoredError(error.message, error.userMessage, {
      status: 400,
      details: error.details,
    });
  }

  const msg = error instanceof Error ? error.message : String(error);

  // Known error codes
  if (msg === 'UNAUTHENTICATED') {
    return NextResponse.json({ error: msg, requestId }, { status: 401 });
  }
  if (msg === 'QUOTA_EXCEEDED') {
    return NextResponse.json({ error: msg, requestId }, { status: 402 });
  }
  if (msg === 'VIDEO_QUOTA_EXCEEDED') {
    return NextResponse.json({ error: msg, requestId }, { status: 402 });
  }
  if (msg === 'QUOTA_EXCEEDED_STORAGE') {
    return NextResponse.json({ error: msg, requestId }, { status: 402 });
  }
  if (msg === 'QUOTA_EXCEEDED_POSTS') {
    return NextResponse.json({ error: msg, requestId }, { status: 402 });
  }
  if (msg === 'BRAND_LIMIT_REACHED') {
    return authoredError(
      msg,
      'Your plan has reached its brand limit. Upgrade your plan or add a brand pack to create another brand.',
      { status: 402 },
    );
  }
  if (msg === 'CHANNEL_LIMIT_REACHED') {
    return authoredError(
      msg,
      'Your plan limits how many channels each brand can connect. Upgrade your plan or disconnect a channel to add another.',
      { status: 402 },
    );
  }
  if (msg === 'SUBSCRIPTION_REQUIRED') {
    return NextResponse.json({ error: msg, requestId }, { status: 402 });
  }
  if (msg === 'TEAM_LIMIT_REACHED') {
    return NextResponse.json({ error: msg, requestId }, { status: 402 });
  }
  if (msg === 'WORKSPACE_LIMIT_REACHED') {
    return NextResponse.json({ error: msg, requestId }, { status: 402 });
  }
  if (msg === 'FORBIDDEN_WORKSPACE' || msg === 'FORBIDDEN') {
    return NextResponse.json({ error: msg, requestId }, { status: 403 });
  }
  if (msg === 'EMAIL_VERIFICATION_REQUIRED') {
    return NextResponse.json({ error: msg, requestId }, { status: 403 });
  }
  if (msg === 'NOT_FOUND') {
    return NextResponse.json({ error: msg, requestId }, { status: 404 });
  }
  if (msg === 'FEATURE_NOT_AVAILABLE') {
    return NextResponse.json({ error: msg, requestId }, { status: 404 });
  }
  if (msg === 'INVALID_PROVIDER') {
    return NextResponse.json({ error: msg, requestId }, { status: 400 });
  }
  if (msg === 'OTP_COOLDOWN') {
    return NextResponse.json({ error: msg, requestId }, { status: 429 });
  }
  if (msg === 'OTP_INVALID' || msg === 'OTP_EXPIRED' || msg === 'OTP_TOO_MANY_ATTEMPTS') {
    return NextResponse.json({ error: msg, requestId }, { status: 400 });
  }
  if (msg === 'EMAIL_IN_USE') {
    return NextResponse.json({ error: msg, requestId }, { status: 409 });
  }
  if (msg === 'WEBHOOK_ENDPOINT_LIMIT_REACHED') {
    return NextResponse.json({ error: msg, requestId }, { status: 409 });
  }
  if (msg === 'USER_DISABLED') {
    return NextResponse.json({ error: msg, requestId }, { status: 403 });
  }
  if (msg === 'INVALID_STATE' || msg === 'STATE_EXPIRED' || msg === 'STATE_MISMATCH') {
    return NextResponse.json({ error: msg, requestId }, { status: 400 });
  }
  if (msg.startsWith('VALIDATION_')) {
    return NextResponse.json({ error: msg, requestId }, { status: 400 });
  }

  // Unknown errors — don't leak internals. No `userMessage`: whatever this
  // was, nobody wrote copy for it, so the client renders its own fallback.
  logger.error('unhandled API error', { event: 'api.unhandled_error', requestId, err: error });
  Sentry.captureException(error, { tags: { requestId } });
  return NextResponse.json(
    { error: 'INTERNAL_ERROR', requestId },
    { status: 500 },
  );
}

/** Shortcut for 200 JSON */
export function apiOk<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** Shortcut for 201 JSON (created) */
export function apiCreated<T>(data: T) {
  return NextResponse.json(data, { status: 201 });
}
