/**
 * The two SLO counters that have to be measured rather than observed.
 *
 * Publish outcomes and webhook deliveries fall out of the tick's own results.
 * Metrics staleness and AI burn do not: nothing in a tick's return value says
 * "these posts stopped collecting metrics three days ago" or "this workspace
 * has burned 90% of its month". Both are cheap reads, and both are kept here
 * rather than in the tick so the tick stays a sequence of steps.
 */

import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { resolveLimits } from '@/lib/stripe/entitlements';
import { listConnections } from '@/lib/platform/connections';

/**
 * How overdue a metrics poll has to be before it counts as stale.
 *
 * The poll schedule decays, so a post can legitimately be a few minutes late
 * when the tick is busy. Six hours is well beyond any legitimate lateness and
 * well inside "this post has silently dropped out of polling", which is the
 * signature of a wiped `externalId`.
 */
const METRICS_STALENESS_GRACE_HOURS = 6;

/** Counting is bounded: the alert cares about the trend, not the exact total. */
const MAX_STALE_POSTS_COUNTED = 500;

export type MetricsStalenessSample = {
  overdue: number;
  graceHours: number;
};

export async function countOverdueMetricsPolls(
  workspaceId: string,
  now = new Date(),
): Promise<MetricsStalenessSample> {
  const cutoff = new Date(now.getTime() - METRICS_STALENESS_GRACE_HOURS * 60 * 60_000).toISOString();

  try {
    // Same (status, metricsNextPollAt) index the poller itself uses, so this
    // adds a query but no index. Aggregate count, not a document read: the
    // number is all we want.
    const snapshot = await adminDb
      .collection(`workspaces/${workspaceId}/posts`)
      .where('status', '==', 'published')
      .where('metricsNextPollAt', '<=', cutoff)
      .orderBy('metricsNextPollAt', 'asc')
      .limit(MAX_STALE_POSTS_COUNTED)
      .count()
      .get();

    return { overdue: snapshot.data().count, graceHours: METRICS_STALENESS_GRACE_HOURS };
  } catch (error) {
    logger.warn('metrics staleness sample failed', {
      event: 'slo.metrics_staleness_sample_failed',
      workspaceId,
      err: error,
    });
    return { overdue: 0, graceHours: METRICS_STALENESS_GRACE_HOURS };
  }
}

export type AiBurnSample = {
  operationsThisMonth: number;
  monthlyLimit: number;
};

export async function readAiOperationBurn(
  workspaceId: string,
  now = new Date(),
): Promise<AiBurnSample> {
  const month = now.toISOString().slice(0, 7);

  try {
    const [usage, subscription] = await Promise.all([
      adminDb.doc(`workspaces/${workspaceId}/aiUsageDaily/${month}`).get(),
      // Workspace-keyed: the tick has no uid, and a workspace's own
      // subscription is the one its AI allowance comes from.
      getEffectiveSubscription({ workspaceId }),
    ]);

    return {
      operationsThisMonth: Number(usage.data()?.aiOperations) || 0,
      monthlyLimit: resolveLimits(subscription).intelligenceAiOperationsPerMonth,
    };
  } catch (error) {
    logger.warn('AI burn sample failed', {
      event: 'slo.ai_burn_sample_failed',
      workspaceId,
      err: error,
    });
    // A zero limit is the "do not emit" signal in emitAiBurnSlo, so a failed
    // sample stays silent rather than reporting a fake 0% burn.
    return { operationsThisMonth: 0, monthlyLimit: 0 };
  }
}

export type ChannelHealthSample = {
  unhealthy: number;
  degradedTokens: number;
};

/**
 * Workspace-scope connections that are not `connected`, and those running on a
 * short-lived token after a failed long-lived exchange.
 *
 * Dashboard signal rather than a page: one expired Instagram token is a
 * customer problem, a hundred in an hour is ours. Reads only the
 * workspace-scope connection list, which the tick's other steps have usually
 * already warmed.
 */
export async function sampleChannelHealth(workspaceId: string): Promise<ChannelHealthSample> {
  try {
    const connections = await listConnections(workspaceId);
    return {
      unhealthy: connections.filter((connection) => connection.status !== 'connected').length,
      degradedTokens: connections.filter(
        (connection) => connection.metadata?.tokenExchangeDegraded === true,
      ).length,
    };
  } catch (error) {
    logger.warn('channel health sample failed', {
      event: 'slo.channel_health_sample_failed',
      workspaceId,
      err: error,
    });
    return { unhealthy: 0, degradedTokens: 0 };
  }
}
