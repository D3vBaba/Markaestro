import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Workspace resolution for requests that do NOT name a workspace
 * (`/api/stripe/*` used to be the whole set). The order matters: the UI's
 * cookie selection has to beat the `workspaces/default` fallback, or a user
 * who belongs to both gets billing resolved against `default` while the app
 * shows another workspace — which surfaced as a 403 on checkout.
 */

const verifyIdTokenMock = vi.fn();
const docMock = vi.fn();
const collectionGroupMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminAuth: { verifyIdToken: verifyIdTokenMock },
  adminDb: {
    doc: (path: string) => docMock(path),
    collectionGroup: (name: string) => collectionGroupMock(name),
  },
}));

vi.mock('@/lib/team-invites', () => ({
  countPendingInvitesForEmail: vi.fn().mockResolvedValue(0),
}));

/** Member docs keyed by their full Firestore path. */
let members: Record<string, { uid: string; role: string; joinedAt?: string }> = {};

function memberDoc(path: string) {
  const data = members[path];
  return { get: async () => ({ exists: Boolean(data), data: () => data }) };
}

function request(cookie: string) {
  return new Request('https://app.markaestro.com/api/stripe/checkout', {
    method: 'POST',
    headers: { authorization: 'Bearer token_1', cookie },
  });
}

describe('requireContext workspace resolution (no workspaceId on the request)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    members = {};
    verifyIdTokenMock.mockResolvedValue({ uid: 'user_1', email: 'owner@example.com', email_verified: true });
    docMock.mockImplementation(memberDoc);
    collectionGroupMock.mockReturnValue({
      where: () => ({
        get: async () => ({
          empty: Object.keys(members).length === 0,
          docs: Object.entries(members).map(([path, data]) => ({
            ref: { path },
            data: () => data,
          })),
        }),
      }),
    });
  });

  it('prefers the cookie-selected workspace over membership in `default`', async () => {
    members['workspaces/default/members/user_1'] = { uid: 'user_1', role: 'member' };
    members['workspaces/ws-mine/members/user_1'] = { uid: 'user_1', role: 'owner' };

    const { requireContext } = await import('../server-auth');
    const ctx = await requireContext(request('markaestro_ws=ws-mine'));

    expect(ctx.workspaceId).toBe('ws-mine');
    expect(ctx.role).toBe('owner');
  });

  it('falls back to `default` when no cookie is set', async () => {
    members['workspaces/default/members/user_1'] = { uid: 'user_1', role: 'owner' };

    const { requireContext } = await import('../server-auth');
    const ctx = await requireContext(request(''));

    expect(ctx.workspaceId).toBe('default');
  });

  it('ignores a stale cookie pointing at a workspace the user left', async () => {
    members['workspaces/default/members/user_1'] = { uid: 'user_1', role: 'owner' };

    const { requireContext } = await import('../server-auth');
    const ctx = await requireContext(request('markaestro_ws=ws-gone'));

    expect(ctx.workspaceId).toBe('default');
  });
});
