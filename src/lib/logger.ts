/**
 * Minimal structured server logger.
 *
 * Emits JSON on a single line per event, which Cloud Run / Cloud Logging
 * parses natively into structured log entries. Keeps behaviour local (no
 * transport dependency) so we can swap in pino/winston later without
 * touching call sites.
 *
 * Call sites should NEVER log PII: raw email, OAuth tokens, or full
 * request bodies. Prefer uid + workspaceId + event shape.
 */

type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

type LogFields = Record<string, unknown> & {
  event?: string;
  uid?: string;
  workspaceId?: string;
  requestId?: string;
  durationMs?: number;
};

function emit(severity: Severity, message: string, fields: LogFields = {}): void {
  // Cloud Logging maps `severity` automatically when the JSON has that key.
  const record: Record<string, unknown> = {
    severity,
    message,
    time: new Date().toISOString(),
    ...fields,
  };

  // Split error-class values into a log-friendly shape without blowing up.
  if (record.err instanceof Error) {
    const err = record.err as Error;
    record.err = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }

  const line = JSON.stringify(record);
  if (severity === 'ERROR' || severity === 'CRITICAL') {
    console.error(line);
  } else if (severity === 'WARNING') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit('DEBUG', message, fields),
  info: (message: string, fields?: LogFields) => emit('INFO', message, fields),
  warn: (message: string, fields?: LogFields) => emit('WARNING', message, fields),
  error: (message: string, fields?: LogFields) => emit('ERROR', message, fields),
  critical: (message: string, fields?: LogFields) => emit('CRITICAL', message, fields),
};

/**
 * Derive a lightweight request id from the current request. Cloud Run
 * injects `x-cloud-trace-context` so we prefer that when present; fall
 * back to a random id for local development.
 */
export function requestIdFromHeaders(headers: Headers): string {
  const trace = headers.get('x-cloud-trace-context');
  if (trace) return trace.split('/')[0] || trace;
  const forwarded = headers.get('x-request-id');
  if (forwarded) return forwarded;
  return Math.random().toString(36).slice(2, 10);
}
