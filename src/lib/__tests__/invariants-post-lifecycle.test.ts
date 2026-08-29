/**
 * Invariants for the post lifecycle.
 *
 * These are written as a sweep over `postStatuses` rather than one test per
 * bug, so adding a status to the enum without deciding what it means here
 * fails the suite instead of silently inheriting whichever branch it happens
 * to fall into.
 */
import { describe, expect, it } from 'vitest';
import { postStatuses, RESETTABLE_PUBLISH_STATES, isResettablePublishState } from '../schemas';
import { assertPostMutable, isPublishInFlight } from '../social/post-mutation-guards';
import { LEGACY_EXPORTED_FOR_REVIEW_STATUS, PLATFORM_ACTION_REQUIRED_STATUS } from '../manual-publish-flow';
import { ApiValidationError } from '../api-response';

/**
 * The decision table. Every status in the enum must appear here, and every
 * entry must say both things: whether an edit may clear publish state, and
 * whether the post may be mutated while it carries a live publish lease.
 */
const LIFECYCLE_RULES: Record<string, { clearsPublishState: boolean }> = {
  draft: { clearsPublishState: true },
  scheduled: { clearsPublishState: true },
  publishing: { clearsPublishState: false },
  published: { clearsPublishState: false },
  platform_action_required: { clearsPublishState: true },
  failed: { clearsPublishState: true },
  partial_failed: { clearsPublishState: true },
};

describe('post lifecycle invariants', () => {
  it('has a documented decision for every status in the enum', () => {
    for (const status of postStatuses) {
      expect(
        LIFECYCLE_RULES[status],
        `postStatuses gained "${status}" with no lifecycle decision. Decide whether editing it may clear publish state, then add it here.`,
      ).toBeDefined();
    }
  });

  it('clears publish state only for statuses that have not gone out', () => {
    for (const status of postStatuses) {
      expect(isResettablePublishState(status), status).toBe(LIFECYCLE_RULES[status].clearsPublishState);
    }
  });

  it('never clears publish state for a published post', () => {
    // The regression this whole item exists for: blanking externalId on a live
    // post silently detaches it from the metrics poller forever.
    expect(isResettablePublishState('published')).toBe(false);
    expect(RESETTABLE_PUBLISH_STATES).not.toContain('published');
  });

  it('never clears publish state for a post the publisher is holding', () => {
    expect(isResettablePublishState('publishing')).toBe(false);
  });

  it('covers the legacy exported-for-review status', () => {
    expect(isResettablePublishState(PLATFORM_ACTION_REQUIRED_STATUS)).toBe(true);
    expect(isResettablePublishState(LEGACY_EXPORTED_FOR_REVIEW_STATUS)).toBe(true);
  });

  it('treats unknown and malformed statuses as not resettable', () => {
    expect(isResettablePublishState('something_new')).toBe(false);
    expect(isResettablePublishState(undefined)).toBe(false);
    expect(isResettablePublishState(null)).toBe(false);
    expect(isResettablePublishState(42)).toBe(false);
  });
});

describe('post mutation guards', () => {
  const now = new Date('2026-08-29T12:00:00.000Z');
  const liveLease = new Date('2026-08-29T12:05:00.000Z').toISOString();
  const staleLease = new Date('2026-08-29T11:50:00.000Z').toISOString();

  it('blocks edit and delete while a publish lease is live', () => {
    const post = { status: 'publishing', publishLeaseExpiresAt: liveLease };
    expect(isPublishInFlight(post, now)).toBe(true);
    expect(() => assertPostMutable(post, 'delete', now)).toThrow(ApiValidationError);
    expect(() => assertPostMutable(post, 'update', now)).toThrow(ApiValidationError);
  });

  it('reports the blocked mutation with a retry hint', () => {
    const post = { status: 'publishing', publishLeaseExpiresAt: liveLease };
    try {
      assertPostMutable(post, 'delete', now);
      throw new Error('expected assertPostMutable to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiValidationError);
      const validation = error as ApiValidationError;
      expect(validation.message).toBe('VALIDATION_POST_IS_PUBLISHING');
      expect(validation.details).toMatchObject({ status: 'publishing', operation: 'delete', retryAfterSeconds: 60 });
      expect(validation.userMessage).toContain('being published right now');
    }
  });

  it('allows delete once the lease has expired, so a dead run is not a trap', () => {
    // A post stuck in `publishing` because the instance died must stay
    // deletable; recovery reclaims it, and until then the user is not stuck.
    const post = { status: 'publishing', publishLeaseExpiresAt: staleLease };
    expect(isPublishInFlight(post, now)).toBe(false);
    expect(() => assertPostMutable(post, 'delete', now)).not.toThrow();
    expect(() => assertPostMutable(post, 'update', now)).not.toThrow();
  });

  it('treats a publishing post with no recorded lease as in flight', () => {
    // The publisher writes status and lease together, so a missing lease is an
    // old document shape rather than proof the run is dead. Refuse.
    expect(isPublishInFlight({ status: 'publishing' }, now)).toBe(true);
    expect(isPublishInFlight({ status: 'publishing', publishLeaseExpiresAt: '' }, now)).toBe(true);
    expect(isPublishInFlight({ status: 'publishing', publishLeaseExpiresAt: 123 }, now)).toBe(true);
  });

  it('never blocks a post that is not publishing', () => {
    for (const status of postStatuses) {
      if (status === 'publishing') continue;
      const post = { status, publishLeaseExpiresAt: liveLease };
      expect(isPublishInFlight(post, now), status).toBe(false);
      expect(() => assertPostMutable(post, 'delete', now), status).not.toThrow();
    }
  });
});
