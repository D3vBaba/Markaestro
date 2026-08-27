import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import * as Sentry from '@sentry/nextjs';
import crypto from 'crypto';
import { logger } from '@/lib/logger';

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
 * Centralized API error → HTTP response mapper.
 * Handles Zod validation errors, known error codes, and unknown errors.
 */
export function apiError(error: unknown): NextResponse {
  // Helpers such as applyRateLimit intentionally throw a fully-formed 429.
  // Preserve it instead of converting it into a generic 500 response.
  if (error instanceof Response) return error as NextResponse;

  const requestId = crypto.randomUUID();

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
    return NextResponse.json(
      {
        error: msg,
        message: 'Your plan has reached its brand limit. Upgrade your plan or add a brand pack to create another brand.',
        requestId,
      },
      { status: 402 },
    );
  }
  if (msg === 'CHANNEL_LIMIT_REACHED') {
    return NextResponse.json(
      {
        error: msg,
        message: 'Your plan limits how many channels each brand can connect. Upgrade your plan or disconnect a channel to add another.',
        requestId,
      },
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

  // Unknown errors — don't leak internals
  console.error(`[${requestId}] Unhandled API error:`, error);
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
