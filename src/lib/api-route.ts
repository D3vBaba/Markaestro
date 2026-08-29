/**
 * `defineRoute`: the declarative route wrapper (4.5).
 *
 * Rate limiting reached 9 hand-instrumented routes out of ~120 because every
 * route opted IN to each protection separately, which meant the next new
 * route started with none of them. This inverts the pattern: a wrapped route
 * gets authentication, authorization, a rate limit, and the `apiError`
 * boundary by construction, and *unlimited* becomes an explicit opt-out
 * (`rateLimit: null`) that `scripts/check-route-contracts.mjs` can grep for.
 *
 * Migration is deliberately incremental, exactly as the plan prescribes:
 * every NEW session-authenticated route uses this wrapper (the route
 * contract checker recognises `defineRoute(` as satisfying all four
 * invariants), and existing routes migrate opportunistically when they are
 * next touched. A big-bang rewrite of 120 files would be all risk and no
 * behaviour change.
 *
 * Scope note: this wraps SESSION-authenticated app routes. The public and
 * Connect surfaces already have their own uniform wrapper in
 * `requirePublicApiContext` (auth, scope, per-path + global rate limits,
 * usage counters), which is the same idea grown in place; folding the two
 * together would change the key-auth hot path for no gain.
 */

import { apiError } from '@/lib/api-response';
import { requireContext, type RequestContext } from '@/lib/server-auth';
import { requirePermission, requireAdmin, requireOwner, type WorkspacePermission } from '@/lib/rbac';
import { applyRateLimit, RATE_LIMITS, type RateLimitConfig } from '@/lib/rate-limit';

export type RouteConfig = {
  /**
   * Workspace permission(s) the caller must hold; every listed permission is
   * required. Use `role` for the admin/owner gates that predate permissions.
   */
  permission?: WorkspacePermission | WorkspacePermission[];
  /** Role gate, for routes authorized by rank rather than permission. */
  role?: 'admin' | 'owner';
  /**
   * Rate-limit tier. Omitted = `RATE_LIMITS.api`, so a new route is limited
   * by default. `null` is the explicit, greppable opt-out and needs a comment
   * at the call site saying why.
   */
  rateLimit?: RateLimitConfig | null;
  /**
   * Limiter key. Defaults to the caller's uid, which is right for almost
   * everything; use a workspace-scoped key for actions a team must not
   * multiply by adding seats (see `RATE_LIMITS.publish`).
   */
  rateLimitKey?: (ctx: RequestContext) => string;
  /** Block unverified emails, for routes that push content outbound. */
  requireVerifiedEmail?: boolean;
};

type RouteExtra<P> = { params: Promise<P> };

export type RouteHandler<P extends Record<string, string> = Record<string, string>> = (
  req: Request,
  ctx: RequestContext,
  extra: RouteExtra<P>,
) => Promise<Response> | Response;

export function defineRoute<P extends Record<string, string> = Record<string, string>>(
  config: RouteConfig,
  handler: RouteHandler<P>,
): (req: Request, extra?: RouteExtra<P>) => Promise<Response> {
  return async (req, extra) => {
    try {
      const ctx = await requireContext(req);

      if (config.role === 'owner') requireOwner(ctx);
      else if (config.role === 'admin') requireAdmin(ctx);

      const permissions = Array.isArray(config.permission)
        ? config.permission
        : config.permission ? [config.permission] : [];
      for (const permission of permissions) requirePermission(ctx, permission);

      if (config.requireVerifiedEmail && !ctx.emailVerified) {
        throw new Error('EMAIL_VERIFICATION_REQUIRED');
      }

      if (config.rateLimit !== null) {
        const tier = config.rateLimit ?? RATE_LIMITS.api;
        const key = config.rateLimitKey?.(ctx) ?? `uid:${ctx.uid}`;
        await applyRateLimit(req, tier, { key });
      }

      return await handler(req, ctx, extra ?? { params: Promise.resolve({} as P) });
    } catch (error) {
      // applyRateLimit signals a 429 by throwing the Response it wants sent.
      if (error instanceof Response) return error;
      return apiError(error);
    }
  };
}
