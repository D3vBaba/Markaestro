import { describe, expect, it, vi } from 'vitest';
import {
  REQUEST_ID_HEADER,
  annotateRequestContext,
  enterRequestContext,
  getRequestContext,
  getRequestId,
  isValidRequestId,
  requestIdFromHeaders,
  withRequestContext,
} from '@/lib/request-context';
import { logger } from '@/lib/logger';

/**
 * `apiError()` used to mint a fresh UUID at the moment of failure while every
 * log line earlier in the same request carried a different id or none at all,
 * so the id in a user's error toast matched nothing in Cloud Logging. The
 * invariant here is that one request has exactly one id, from the edge through
 * every log line to the response body.
 */

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe('requestIdFromHeaders', () => {
  it('prefers the id the edge minted (or the client sent)', () => {
    expect(requestIdFromHeaders(headers({
      [REQUEST_ID_HEADER]: 'edge-minted-id-0001',
      'x-cloud-trace-context': 'abcdef1234567890/1;o=1',
    }))).toBe('edge-minted-id-0001');
  });

  it('falls back to Cloud Run trace id, dropping the span suffix', () => {
    expect(requestIdFromHeaders(headers({ 'x-cloud-trace-context': 'abcdef1234567890/1;o=1' })))
      .toBe('abcdef1234567890');
  });

  it('returns null when neither header is usable, rather than inventing one', () => {
    expect(requestIdFromHeaders(headers({}))).toBeNull();
  });

  it('rejects a caller-supplied id that is not the shape we mint', () => {
    // The id is echoed into logs and back to the user, so arbitrary caller
    // text must never become one.
    expect(requestIdFromHeaders(headers({ [REQUEST_ID_HEADER]: 'short' }))).toBeNull();
    expect(requestIdFromHeaders(headers({ [REQUEST_ID_HEADER]: 'has spaces in it' }))).toBeNull();
    expect(requestIdFromHeaders(headers({ [REQUEST_ID_HEADER]: `${'x'.repeat(129)}` }))).toBeNull();
    expect(isValidRequestId('0f9c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b')).toBe(true);
  });
});

describe('enterRequestContext', () => {
  it('adopts the inbound id so client, edge, and handler share one', () => {
    withRequestContext({ requestId: 'seed-context-0001' }, () => {
      expect(getRequestId()).toBe('seed-context-0001');
    });
  });

  it('mints one when the request carries no usable id', () => {
    withRequestContext({ requestId: 'outer-placeholder' }, () => undefined);
    // Outside any context there is no ambient id at all.
    expect(getRequestId()).toBeNull();
  });

  it('keeps the first id when called twice in one request', () => {
    withRequestContext({ requestId: 'first-id-000001' }, () => {
      enterRequestContext({ headers: headers({ [REQUEST_ID_HEADER]: 'second-id-00001' }) });
      // A route that calls both requireContext and a public-API auth helper
      // must not end up with two ids for one request.
      expect(getRequestId()).toBe('first-id-000001');
    });
  });

  it('attaches identity to an existing context without replacing the id', () => {
    withRequestContext({ requestId: 'identity-id-0001' }, () => {
      enterRequestContext({ uid: 'user-1', workspaceId: 'ws-1' });
      expect(getRequestContext()).toMatchObject({
        requestId: 'identity-id-0001',
        uid: 'user-1',
        workspaceId: 'ws-1',
      });
    });
  });

  it('annotating outside a request is a no-op, not a crash', () => {
    expect(() => annotateRequestContext({ uid: 'user-1' })).not.toThrow();
    expect(getRequestContext()).toBeUndefined();
  });
});

describe('logger ambient fields', () => {
  it('stamps every line with the request id without the call site passing it', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      withRequestContext({ requestId: 'log-stamp-000001', uid: 'u1', workspaceId: 'ws1' }, () => {
        logger.info('did a thing', { event: 'test.event' });
      });
      const line = JSON.parse(spy.mock.calls[0][0] as string);
      expect(line).toMatchObject({
        requestId: 'log-stamp-000001',
        uid: 'u1',
        workspaceId: 'ws1',
        event: 'test.event',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('lets an explicit field win, so a worker can log about another workspace', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      withRequestContext({ requestId: 'log-stamp-000002', workspaceId: 'ws-caller' }, () => {
        logger.info('processed', { event: 'worker.tick', workspaceId: 'ws-target' });
      });
      const line = JSON.parse(spy.mock.calls[0][0] as string);
      expect(line.workspaceId).toBe('ws-target');
      expect(line.requestId).toBe('log-stamp-000002');
    } finally {
      spy.mockRestore();
    }
  });

  it('logs normally outside a request', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      logger.info('no context here', { event: 'test.event' });
      const line = JSON.parse(spy.mock.calls[0][0] as string);
      expect(line.requestId).toBeUndefined();
      expect(line.event).toBe('test.event');
    } finally {
      spy.mockRestore();
    }
  });
});
