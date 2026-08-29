import { z } from 'zod';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { getAdapterForChannel } from '@/lib/platform/registry';
import {
  getConnectionForChannel,
  listChannelConnections,
  markConnectionAuthError,
} from '@/lib/platform/connections';
import { socialChannels, type SocialChannel } from '@/lib/schemas';
import { getSocialChannelLabel } from '@/lib/social/channel-catalog';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * One connection test for every channel.
 *
 * All five adapters implemented `testConnection()` and only two were reachable
 * over HTTP, neither of them from the UI, so a user whose Instagram token had
 * quietly gone bad had no in-app way to find out. This replaces the per-
 * provider `meta/test` and `tiktok/test` routes.
 *
 * The `label` in a successful response is the platform's own account name,
 * which answers the question people actually have: not "is something
 * connected" but "*which* account is connected".
 */
const testConnectionSchema = z.object({
  productId: z.string().trim().min(1).max(2000),
  /** Test one linked account; omitted, every account for the channel is tested. */
  destinationId: z.string().trim().max(2000).optional(),
});

type ChannelTestResult = {
  destinationId: string | null;
  ok: boolean;
  label?: string;
  error?: string;
};

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'integrations.manage');
    // Every test is an outbound platform call, so it is metered per user
    // rather than left as a free way to generate traffic against a provider.
    await applyRateLimit(req, RATE_LIMITS.api, { key: `integration-test:${ctx.uid}` });

    const { provider } = await params;
    if (!(socialChannels as readonly string[]).includes(provider)) {
      throw new Error('INVALID_PROVIDER');
    }
    const channel = provider as SocialChannel;
    const { productId, destinationId } = testConnectionSchema.parse(await req.json().catch(() => ({})));

    const adapter = getAdapterForChannel(channel);
    if (!adapter) throw new Error('INVALID_PROVIDER');

    // A brand can link several accounts per channel. Test the one named, or
    // all of them, so a single broken account is identifiable rather than
    // hidden behind an aggregate "connected".
    let connections = await listChannelConnections(ctx.workspaceId, channel, productId);
    if (destinationId) {
      const single = await getConnectionForChannel(
        ctx.workspaceId,
        channel,
        productId,
        undefined,
        destinationId,
      );
      connections = single ? [single] : [];
    }

    if (connections.length === 0) {
      return apiOk({
        ok: false,
        channel,
        error: `${getSocialChannelLabel(channel)} is not connected for this brand.`,
        accounts: [],
      });
    }

    const accounts: ChannelTestResult[] = await Promise.all(
      connections.map(async (connection) => {
        const result = await adapter.testConnection(connection);
        // Testing a connection should also repair the status the rest of the
        // UI reads: a failed test is the same signal a failed publish gives,
        // so it writes the same annotation instead of leaving the channel
        // advertising itself as ready.
        if (!result.ok) {
          await markConnectionAuthError(connection, result.error || 'Connection test failed')
            .catch((error: unknown) => {
              logger.warn('connection test status annotation failed', {
                event: 'integrations.test.annotate_failed',
                workspaceId: ctx.workspaceId,
                channel,
                err: error,
              });
            });
        }
        return {
          destinationId: connection.accountKey ?? null,
          ok: result.ok,
          ...(result.label ? { label: result.label } : {}),
          ...(result.error ? { error: result.error } : {}),
        };
      }),
    );

    const ok = accounts.every((account) => account.ok);
    logger.info('connection test run', {
      event: 'integrations.test.run',
      workspaceId: ctx.workspaceId,
      channel,
      accounts: accounts.length,
      ok,
    });

    return apiOk({
      ok,
      channel,
      label: accounts.find((account) => account.label)?.label,
      error: accounts.find((account) => account.error)?.error,
      accounts,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return apiError(error);
  }
}
