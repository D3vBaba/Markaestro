import { beforeEach, describe, expect, it, vi } from 'vitest';

const { records, reads } = vi.hoisted(() => ({
  records: new Map<string, Record<string, unknown>>(), reads: [] as string[],
}));
vi.mock('@/lib/firebase-admin', () => {
  const doc = (path: string) => ({ path, get: async () => {
    reads.push(path);
    return { exists: records.has(path), data: () => records.get(path) };
  } });
  return { adminDb: {
    doc, collection: (path: string) => ({ doc: (id: string) => doc(`${path}/${id}`) }),
    runTransaction: async (fn: (tx: unknown) => unknown) => fn({
      get: (ref: ReturnType<typeof doc>) => ref.get(),
      set: (ref: ReturnType<typeof doc>, data: Record<string, unknown>, options?: { merge?: boolean }) =>
        records.set(ref.path, { ...(options?.merge ? records.get(ref.path) : {}), ...data }),
      delete: (ref: ReturnType<typeof doc>) => records.delete(ref.path),
    }),
  } };
});

import { getEffectiveLimits } from '../stripe/entitlements';
import { getEffectiveSubscription, getSubscriptionForWorkspace, effectiveTier } from '../stripe/subscription';
import { acceptPendingInvite } from '../team-invites';
import { reserveStorage } from '../usage';
import { hasPermissionForRole } from '../rbac';

const premium = { status: 'active', tier: 'business', addonBrands: 2 };

beforeEach(() => {
  records.clear(); reads.length = 0;
  records.set('workspaces/team', { createdBy: 'owner', name: 'Premium team' });
  records.set('subscriptions/owner', { ...premium });
  records.set('usage/workspace:team', { storageBytes: 1954617141 });
});

describe('premium workspace access', () => {
  it('lets a newly invited member upload against the legacy workspace plan without a personal subscription', async () => {
    records.set('workspaces/team/pendingInvites/invitee@example.com', { role: 'member' });
    await expect(acceptPendingInvite({ uid: 'invitee', email: 'invitee@example.com', workspaceId: 'team' }))
      .resolves.toMatchObject({ role: 'member' });
    const limits = await getEffectiveLimits('invitee', 'team');
    expect(limits.tier).toBe('business');
    expect(limits).toEqual(await getEffectiveLimits('owner', 'team'));
    await expect(reserveStorage('team', 19308361, limits)).resolves.toMatchObject({ allowed: true });
    expect(records.has('subscriptions/invitee')).toBe(false);
    expect(hasPermissionForRole('member', 'posts.write')).toBe(true);
    expect(hasPermissionForRole('member', 'billing.manage')).toBe(false);
    expect(hasPermissionForRole('analyst', 'posts.write')).toBe(false);
  });

  it('uses the same legacy workspace plan for background jobs and billing callers', async () => {
    expect(effectiveTier(await getEffectiveSubscription({ workspaceId: 'team' }))).toBe('business');
    await expect(getSubscriptionForWorkspace('team')).resolves.toMatchObject({ ...premium, workspaceId: 'team' });
  });

  it.each(['active', 'canceled', 'past_due'])('honors a canonical %s record over legacy premium', async status => {
    records.set('subscriptions/team', { status, tier: 'starter' });
    const limits = await getEffectiveLimits('invitee', 'team');
    expect(limits.tier).toBe(status === 'active' ? 'starter' : 'free');
    expect(reads).not.toContain('subscriptions/owner');
  });

  it('preserves workspace paid access even when the invited member has a lower personal plan', async () => {
    records.set('subscriptions/team', { ...premium, workspaceId: 'team' });
    records.set('accountEntitlements/invitee', { status: 'active', tier: 'starter' });
    expect((await getEffectiveLimits('invitee', 'team')).tier).toBe('business');
  });

  it('does not carry workspace premium into the invitee’s personal workspace', async () => {
    records.set('workspaces/personal', { createdBy: 'invitee' });
    expect((await getEffectiveLimits('invitee', 'team')).tier).toBe('business');
    expect((await getEffectiveLimits('invitee', 'personal')).tier).toBe('free');
  });

  it('rejects a legacy subscription explicitly assigned to another workspace', async () => {
    records.set('subscriptions/owner', { ...premium, workspaceId: 'different-team' });
    expect((await getEffectiveLimits('invitee', 'team')).tier).toBe('free');
  });

  it('does not resurrect canceled legacy subscriptions or expired trials', async () => {
    records.set('subscriptions/owner', { ...premium, status: 'canceled' });
    expect((await getEffectiveLimits('invitee', 'team')).tier).toBe('free');
    records.set('subscriptions/owner', { ...premium, status: 'trialing', trialEnd: '2020-01-01T00:00:00Z' });
    expect((await getEffectiveLimits('invitee', 'team')).tier).toBe('free');
  });

  it('does not infer a workspace plan from the requesting member’s legacy subscription', async () => {
    records.delete('subscriptions/owner');
    records.set('subscriptions/invitee', premium);
    expect((await getEffectiveLimits('invitee', 'team')).tier).toBe('free');
  });

  it('handles absent workspaces and creators without looking up an arbitrary subscription', async () => {
    records.delete('workspaces/team');
    await expect(getSubscriptionForWorkspace('team')).resolves.toBeNull();
    records.set('workspaces/team', { createdBy: 'invalid/path' });
    await expect(getSubscriptionForWorkspace('team')).resolves.toBeNull();
  });
});
