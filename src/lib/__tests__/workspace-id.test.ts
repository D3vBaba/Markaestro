import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_ID,
  getWorkspaceId,
  isValidWorkspaceId,
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
