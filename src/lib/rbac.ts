import type { RequestContext } from './server-auth';
import type { WorkspaceRole } from './schemas';

/**
 * Role hierarchy: owner > admin > member
 */
const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

/**
 * Check if the user's role meets the minimum required role.
 * Throws FORBIDDEN if insufficient.
 */
export function requireRole(ctx: RequestContext, minimumRole: WorkspaceRole) {
  const userLevel = ROLE_LEVEL[ctx.role] ?? 0;
  const requiredLevel = ROLE_LEVEL[minimumRole];
  if (userLevel < requiredLevel) {
    throw new Error('FORBIDDEN');
  }
}

/**
 * Shortcut: require at least admin role.
 */
export function requireAdmin(ctx: RequestContext) {
  requireRole(ctx, 'admin');
}

/**
 * Shortcut: require owner role.
 */
export function requireOwner(ctx: RequestContext) {
  requireRole(ctx, 'owner');
}
