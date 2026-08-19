import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_ID,
  getWorkspaceId,
  isValidWorkspaceId,
  mergeWorkspaceHint,
  pickSelectedWorkspaceId,
  rankDefaultWorkspaceFirst,
  shouldDeferPersonalWorkspace,
  workspaceSlugFromName,
} from '../workspace';

describe('workspace ids', () => {
  it('empty input resolves to the default sentinel', () => {
    expect(getWorkspaceId(null)).toBe(DEFAULT_WORKSPACE_ID);
    expect(getWorkspaceId('  ')).toBe(DEFAULT_WORKSPACE_ID);
    expect(getWorkspaceId('ws-abc')).toBe('ws-abc');
  });

  it('validates the id pattern', () => {
    expect(isValidWorkspaceId('default')).toBe(true);
    expect(isValidWorkspaceId('acme-team-m1x2')).toBe(true);
    expect(isValidWorkspaceId('-leading-dash')).toBe(false);
    expect(isValidWorkspaceId('')).toBe(false);
    expect(isValidWorkspaceId('_pending')).toBe(false);
    expect(isValidWorkspaceId('a'.repeat(81))).toBe(false);
  });
});

describe('workspaceSlugFromName', () => {
  it('produces a valid id from a normal name', () => {
    const slug = workspaceSlugFromName('Acme Marketing Team', 1_000_000);
    expect(slug).toMatch(/^acme-marketing-team-[a-z0-9]+$/);
    expect(isValidWorkspaceId(slug)).toBe(true);
  });

  it('never emits an invalid id for hostile names', () => {
    // Names made of punctuation / non-latin characters used to produce a
    // slug starting with '-', creating a workspace that could never be
    // addressed again.
    for (const name of ['***', '---', '   ', '日本語だけ', '!@#$%^&*()', '-x-']) {
      const slug = workspaceSlugFromName(name, 42);
      expect(isValidWorkspaceId(slug), `name ${JSON.stringify(name)} → ${slug}`).toBe(true);
    }
  });

  it('caps the slug well under the 80-char id limit for very long names', () => {
    const slug = workspaceSlugFromName('x'.repeat(200), Date.now());
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(isValidWorkspaceId(slug)).toBe(true);
  });
});

describe('pickSelectedWorkspaceId', () => {
  const personal = 'ws-personal';
  const team = 'acme-team-1';

  it('always honors an explicit preference, even if the list is stale', () => {
    expect(pickSelectedWorkspaceId({
      workspaceIds: [personal],
      previousId: personal,
      storedId: personal,
      preferredId: team,
    })).toBe(team);
  });

  it('treats the legacy workspace id "default" as a real selectable workspace', () => {
    expect(pickSelectedWorkspaceId({
      workspaceIds: [personal],
      previousId: personal,
      storedId: personal,
      preferredId: DEFAULT_WORKSPACE_ID,
    })).toBe(DEFAULT_WORKSPACE_ID);
    expect(mergeWorkspaceHint(
      [{ id: personal, name: 'My Workspace' }],
      { id: DEFAULT_WORKSPACE_ID, name: 'Default Workspace' },
    )).toEqual([
      { id: DEFAULT_WORKSPACE_ID, name: 'Default Workspace' },
      { id: personal, name: 'My Workspace' },
    ]);
  });

  it('keeps the live selection when it is still a member workspace', () => {
    expect(pickSelectedWorkspaceId({
      workspaceIds: [personal, team],
      previousId: team,
      storedId: personal,
    })).toBe(team);
  });

  it('drops a live selection that is no longer in the list', () => {
    expect(pickSelectedWorkspaceId({
      workspaceIds: [personal],
      previousId: team,
      storedId: personal,
    })).toBe(personal);
  });

  it('keeps the legacy default workspace when it is in the membership list', () => {
    expect(pickSelectedWorkspaceId({
      workspaceIds: [DEFAULT_WORKSPACE_ID, personal],
      previousId: DEFAULT_WORKSPACE_ID,
      storedId: personal,
    })).toBe(DEFAULT_WORKSPACE_ID);
  });

  it('restores the persisted selection when the live id is not in the list', () => {
    expect(pickSelectedWorkspaceId({
      workspaceIds: [personal, team],
      previousId: DEFAULT_WORKSPACE_ID,
      storedId: team,
    })).toBe(team);
  });

  it('prefers the real default tenant over an empty personal workspace on first load', () => {
    expect(pickSelectedWorkspaceId({
      workspaceIds: [personal, DEFAULT_WORKSPACE_ID],
      previousId: '',
      storedId: null,
    })).toBe(DEFAULT_WORKSPACE_ID);
  });

  it('falls back to the first listed workspace, then no selection', () => {
    expect(pickSelectedWorkspaceId({
      workspaceIds: [personal, team],
      previousId: DEFAULT_WORKSPACE_ID,
      storedId: null,
    })).toBe(personal);
    expect(pickSelectedWorkspaceId({
      workspaceIds: [],
      previousId: DEFAULT_WORKSPACE_ID,
      storedId: null,
    })).toBe('');
  });
});

describe('mergeWorkspaceHint', () => {
  it('prepends a missing just-joined workspace', () => {
    const personal = { id: 'ws-personal', name: 'My Workspace' };
    const team = { id: 'acme-team-1', name: 'Acme' };
    expect(mergeWorkspaceHint([personal], team)).toEqual([team, personal]);
  });

  it('does not duplicate a workspace already in the list', () => {
    const team = { id: 'acme-team-1', name: 'Acme' };
    expect(mergeWorkspaceHint([team], { id: 'acme-team-1', name: 'Ignored' })).toEqual([team]);
  });
});

describe('rankDefaultWorkspaceFirst', () => {
  it('moves the real default tenant to the front', () => {
    const personal = { id: 'ws-personal', name: 'My Workspace' };
    const main = { id: DEFAULT_WORKSPACE_ID, name: 'Default Workspace' };
    expect(rankDefaultWorkspaceFirst([personal, main])).toEqual([main, personal]);
  });
});

describe('shouldDeferPersonalWorkspace', () => {
  it('defers bootstrap only for verified users with a live invite', () => {
    expect(shouldDeferPersonalWorkspace(true, 1)).toBe(true);
    expect(shouldDeferPersonalWorkspace(true, 0)).toBe(false);
    expect(shouldDeferPersonalWorkspace(false, 2)).toBe(false);
  });
});
