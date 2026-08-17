import { describe, expect, it } from 'vitest';
import { inviteExpiryMs, isInviteExpired } from '../team-invites';

const NOW = Date.parse('2026-08-17T12:00:00.000Z');

describe('invite expiry', () => {
  it('reads ISO string expiries', () => {
    expect(inviteExpiryMs('2026-08-18T12:00:00.000Z')).toBe(NOW + 24 * 3600_000);
  });

  it('reads Firestore Timestamp-shaped expiries', () => {
    const ts = { toDate: () => new Date(NOW - 1000) };
    expect(inviteExpiryMs(ts)).toBe(NOW - 1000);
  });

  it('treats missing or unparseable expiries as non-expiring', () => {
    expect(inviteExpiryMs(null)).toBeNull();
    expect(inviteExpiryMs(undefined as unknown as null)).toBeNull();
    expect(inviteExpiryMs('not-a-date')).toBeNull();
    expect(isInviteExpired(null, NOW)).toBe(false);
    expect(isInviteExpired('not-a-date', NOW)).toBe(false);
  });

  it('expires strictly in the past, enforced at read time', () => {
    expect(isInviteExpired('2026-08-17T11:59:59.000Z', NOW)).toBe(true);
    expect(isInviteExpired('2026-08-17T12:00:01.000Z', NOW)).toBe(false);
  });
});
