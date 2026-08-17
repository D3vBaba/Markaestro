import { describe, expect, it } from 'vitest';
import {
  hasPermissionForRole,
  requirePermission,
  requireRole,
  requireOwner,
  requireAdmin,
  workspacePermissions,
} from '../rbac';
import type { WorkspaceRole } from '../schemas';

const roles: WorkspaceRole[] = ['owner', 'admin', 'member', 'analyst'];

describe('workspace permission matrix', () => {
  it('owner holds every permission', () => {
    for (const permission of workspacePermissions) {
      expect(hasPermissionForRole('owner', permission)).toBe(true);
    }
  });

  it('owner-only permissions are held by nobody else', () => {
    for (const permission of ['team.roles.manage', 'billing.manage'] as const) {
      expect(hasPermissionForRole('owner', permission)).toBe(true);
      for (const role of ['admin', 'member', 'analyst'] as const) {
        expect(hasPermissionForRole(role, permission)).toBe(false);
      }
    }
  });

  it('analyst is read-only', () => {
    expect(hasPermissionForRole('analyst', 'dashboard.read')).toBe(true);
    for (const permission of workspacePermissions) {
      if (permission === 'dashboard.read') continue;
      expect(hasPermissionForRole('analyst', permission)).toBe(false);
    }
  });

  it('member can create and publish but not manage the workspace', () => {
    expect(hasPermissionForRole('member', 'posts.write')).toBe(true);
    expect(hasPermissionForRole('member', 'posts.publish')).toBe(true);
    expect(hasPermissionForRole('member', 'team.manage')).toBe(false);
    expect(hasPermissionForRole('member', 'integrations.manage')).toBe(false);
  });
});

describe('role guards', () => {
  it('requireRole enforces the hierarchy owner > admin > member > analyst', () => {
    expect(() => requireRole({ role: 'admin' }, 'member')).not.toThrow();
    expect(() => requireRole({ role: 'member' }, 'admin')).toThrow('FORBIDDEN');
    expect(() => requireRole({ role: 'analyst' }, 'member')).toThrow('FORBIDDEN');
  });

  it('requireOwner rejects every non-owner', () => {
    expect(() => requireOwner({ role: 'owner' })).not.toThrow();
    for (const role of roles.filter((r) => r !== 'owner')) {
      expect(() => requireOwner({ role })).toThrow('FORBIDDEN');
    }
  });

  it('requireAdmin accepts owner and admin only', () => {
    expect(() => requireAdmin({ role: 'owner' })).not.toThrow();
    expect(() => requireAdmin({ role: 'admin' })).not.toThrow();
    expect(() => requireAdmin({ role: 'member' })).toThrow('FORBIDDEN');
    expect(() => requireAdmin({ role: 'analyst' })).toThrow('FORBIDDEN');
  });

  it('requirePermission throws FORBIDDEN for missing grants', () => {
    expect(() => requirePermission({ role: 'analyst' }, 'billing.manage')).toThrow('FORBIDDEN');
    expect(() => requirePermission({ role: 'owner' }, 'billing.manage')).not.toThrow();
  });
});
