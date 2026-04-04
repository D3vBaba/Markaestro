import type { WorkspaceRole } from './schemas';

export const workspacePermissions = [
  'analytics.read',
  'products.write',
  'campaigns.write',
  'posts.write',
  'posts.publish',
  'posts.review',
  'ads.write',
  'integrations.manage',
  'team.manage',
  'team.roles.manage',
  'billing.manage',
  'ai.use',
  'events.write',
] as const;

export type WorkspacePermission = (typeof workspacePermissions)[number];
type RoleHolder = { role: WorkspaceRole };

/**
 * Role hierarchy: owner > admin > member > analyst
 */
const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
  analyst: 0,
};

const PERMISSIONS_BY_ROLE: Record<WorkspaceRole, readonly WorkspacePermission[]> = {
  owner: workspacePermissions,
  admin: [
    'analytics.read',
    'products.write',
    'campaigns.write',
    'posts.write',
    'posts.publish',
    'posts.review',
    'ads.write',
    'integrations.manage',
    'team.manage',
    'ai.use',
    'events.write',
  ],
  member: [
    'analytics.read',
    'products.write',
    'campaigns.write',
    'posts.write',
    'posts.publish',
    'ai.use',
    'events.write',
  ],
  analyst: [
    'analytics.read',
  ],
};

export function hasPermissionForRole(role: WorkspaceRole, permission: WorkspacePermission): boolean {
  return PERMISSIONS_BY_ROLE[role]?.includes(permission) ?? false;
}

export function hasPermission(ctx: RoleHolder, permission: WorkspacePermission): boolean {
  return hasPermissionForRole(ctx.role, permission);
}

/**
 * Check if the user's role meets the minimum required role.
 * Throws FORBIDDEN if insufficient.
 */
export function requireRole(ctx: RoleHolder, minimumRole: WorkspaceRole) {
  const userLevel = ROLE_LEVEL[ctx.role] ?? 0;
  const requiredLevel = ROLE_LEVEL[minimumRole];
  if (userLevel < requiredLevel) {
    throw new Error('FORBIDDEN');
  }
}

export function requirePermission(ctx: RoleHolder, permission: WorkspacePermission) {
  if (!hasPermission(ctx, permission)) {
    throw new Error('FORBIDDEN');
  }
}

/**
 * Shortcut: require at least admin role.
 */
export function requireAdmin(ctx: RoleHolder) {
  requireRole(ctx, 'admin');
}

/**
 * Shortcut: require owner role.
 */
export function requireOwner(ctx: RoleHolder) {
  requireRole(ctx, 'owner');
}
