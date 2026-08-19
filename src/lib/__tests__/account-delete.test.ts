import { describe, expect, it } from 'vitest';
import { confirmationMatchesEmail, splitOwnedAndJoined } from '../delete-helpers';

describe('confirmationMatchesEmail', () => {
  it('matches ignoring case and surrounding space', () => {
    expect(confirmationMatchesEmail('  Alex@Markaestro.com ', 'alex@markaestro.com')).toBe(true);
    expect(confirmationMatchesEmail('other@example.com', 'alex@markaestro.com')).toBe(false);
  });
});

describe('splitOwnedAndJoined', () => {
  it('separates owned workspaces from memberships in someone else’s', () => {
    expect(splitOwnedAndJoined([
      { workspaceId: 'default', role: 'owner' },
      { workspaceId: 'ws-personal', role: 'owner' },
      { workspaceId: 'acme-team', role: 'member' },
      { workspaceId: '', role: 'owner' },
    ])).toEqual({
      ownedIds: ['default', 'ws-personal'],
      joinedIds: ['acme-team'],
    });
  });
});
