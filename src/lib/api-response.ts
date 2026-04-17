import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import * as Sentry from '@sentry/nextjs';
import crypto from 'crypto';

/**
 * Centralized API error → HTTP response mapper.
 * Handles Zod validation errors, known error codes, and unknown errors.
 */
export function apiError(error: unknown): NextResponse {
  const requestId = crypto.randomUUID();

  // Zod validation errors → 400 with field-level details
  if (error instanceof ZodError) {
    const issues = error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
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
  if (msg === 'INVALID_PROVIDER') {
    return NextResponse.json({ error: msg, requestId }, { status: 400 });
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
