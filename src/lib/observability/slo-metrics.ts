/**
 * Domain SLO counters.
 *
 * `docs/operations/cost-guardrails.md` covers billing budgets and usage
 * alerts, and `runbooks.md` has the paging chain. Both are
 * infrastructure-shaped: they fire when the platform is unhealthy. Nothing
 * alerted on the *product* failing while the infrastructure stayed green,
 * which is what every Phase 1 bug looked like from the outside. Posts stopped
 * collecting metrics, webhooks stopped being delivered, publishes started
 * failing, and Cloud Run's dashboards showed a healthy service the whole time.
 *
 * These are log-based metrics: one structured line per counter per tick, with
 * the numbers as top-level numeric fields so Cloud Monitoring can extract
 * them without parsing. `scripts/setup-alert-policies.sh` defines the
 * extractors and the policies; `docs/operations/alerting.md` explains what
 * each one means and what to do about it.
 *
 * Emitting is best-effort and never throws: an alert counter must not be able
 * to fail a worker tick.
 */

import { logger } from '@/lib/logger';

/** Log-based metric names. Changing one orphans its alert policy. */
export const SLO_EVENTS = {
  publish: 'slo.publish',
  webhookDelivery: 'slo.webhook_delivery',
  metricsStaleness: 'slo.metrics_staleness',
  aiBurn: 'slo.ai_burn',
  channelHealth: 'slo.channel_health',
} as const;

function emit(event: string, fields: Record<string, unknown>): void {
  try {
    logger.info('slo counter', { event, ...fields });
  } catch {
    // A counter that cannot be written is not worth failing a tick over.
  }
}

/**
 * Publish attempts and failures for one tick.
 *
 * Alert: `publishFailed / publishAttempted` over 30 minutes above ~20%.
 * Catches a platform API change or an expired app credential within one tick
 * instead of one support email.
 */
export function emitPublishSlo(input: {
  workspaceId: string;
  attempted: number;
  failed: number;
  published: number;
  retried: number;
}): void {
  if (input.attempted === 0) return;
  emit(SLO_EVENTS.publish, {
    workspaceId: input.workspaceId,
    publishAttempted: input.attempted,
    publishFailed: input.failed,
    publishPublished: input.published,
    publishRetried: input.retried,
  });
}

/**
 * Webhook deliveries that reached `MAX_WEBHOOK_ATTEMPTS` and were given up on.
 *
 * Alert: dead letters per hour above zero for a sustained window. Catches a
 * bad deploy on a customer's side, and also catches an SSRF-guard rejection
 * that would otherwise be invisible to both of us.
 */
export function emitWebhookDeliverySlo(input: {
  workspaceId: string;
  attempted: number;
  delivered: number;
  deadLettered: number;
}): void {
  if (input.attempted === 0) return;
  emit(SLO_EVENTS.webhookDelivery, {
    workspaceId: input.workspaceId,
    webhookAttempted: input.attempted,
    webhookDelivered: input.delivered,
    webhookDeadLettered: input.deadLettered,
  });
}

/**
 * Published posts whose metrics poll is overdue by more than the grace window.
 *
 * This is the alert that would have caught EH-01 in production. A post whose
 * `externalId` was wiped by an edit silently stops collecting metrics, and its
 * poll schedule stops advancing: overdue and never polled is exactly that
 * signature.
 */
export function emitMetricsStalenessSlo(input: {
  workspaceId: string;
  overdue: number;
  graceHours: number;
}): void {
  if (input.overdue === 0) return;
  emit(SLO_EVENTS.metricsStaleness, {
    workspaceId: input.workspaceId,
    metricsOverduePosts: input.overdue,
    metricsGraceHours: input.graceHours,
  });
}

/**
 * AI operations consumed this month against the workspace's allowance.
 *
 * Alert: burn rate that would exhaust the month early. Catches a retry loop
 * before it eats a customer's whole allowance, which nothing currently
 * prevents.
 */
export function emitAiBurnSlo(input: {
  workspaceId: string;
  operationsThisMonth: number;
  monthlyLimit: number;
}): void {
  if (input.monthlyLimit <= 0) return;
  emit(SLO_EVENTS.aiBurn, {
    workspaceId: input.workspaceId,
    aiOperationsThisMonth: input.operationsThisMonth,
    aiMonthlyLimit: input.monthlyLimit,
    aiBurnPercent: Math.round((input.operationsThisMonth / input.monthlyLimit) * 100),
  });
}

/**
 * Connections that are not `connected`, plus the degraded-token count.
 *
 * Dashboard rather than page: one expired Instagram token is a customer
 * problem, a hundred in an hour is ours. `tokenExchangeDegraded` is the flag
 * the OAuth callback sets when the long-lived exchange failed and it fell
 * back to a token that dies in about an hour.
 */
export function emitChannelHealthSlo(input: {
  workspaceId: string;
  unhealthy: number;
  degradedTokens: number;
}): void {
  if (input.unhealthy === 0 && input.degradedTokens === 0) return;
  emit(SLO_EVENTS.channelHealth, {
    workspaceId: input.workspaceId,
    channelsUnhealthy: input.unhealthy,
    channelsTokenDegraded: input.degradedTokens,
  });
}
