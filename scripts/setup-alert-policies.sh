#!/usr/bin/env bash
# Create the log-based metrics and Cloud Monitoring alert policies for the
# domain SLOs described in docs/operations/alerting.md.
#
# These cover the failure mode the infrastructure alerts in
# cost-guardrails.md cannot see: the product failing while Cloud Run stays
# green. Read that document before changing a threshold here; the numbers are
# starting points chosen from the shape of the failures, not from observed
# production distributions.
#
# Idempotent. Creates what is missing, leaves what exists alone, and never
# deletes: removing an alert must be a deliberate manual act, not a side effect
# of running a script.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - Monitoring and Logging APIs enabled
#   - A notification channel already configured (see cost-guardrails.md);
#     pass its id with NOTIFICATION_CHANNEL to attach policies to it.
#
# Usage:
#   ./scripts/setup-alert-policies.sh
#   NOTIFICATION_CHANNEL=projects/<p>/notificationChannels/<id> ./scripts/setup-alert-policies.sh
#   DRY_RUN=1 ./scripts/setup-alert-policies.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-markaestro-0226220726}"
NOTIFICATION_CHANNEL="${NOTIFICATION_CHANNEL:-}"
DRY_RUN="${DRY_RUN:-0}"

echo "Project: $PROJECT_ID"
if [[ -z "$NOTIFICATION_CHANNEL" ]]; then
  echo "NOTIFICATION_CHANNEL is unset: policies will be created without a"
  echo "notification channel and will fire silently. List channels with:"
  echo "  gcloud alpha monitoring channels list --project=$PROJECT_ID"
  echo ""
fi

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY RUN: $*"
    return 0
  fi
  "$@"
}

# ---------------------------------------------------------------------------
# Log-based metrics
#
# Each extracts one numeric field from the structured line
# src/lib/observability/slo-metrics.ts emits. The `event` field is the metric's
# identity: renaming one in the app orphans the metric and its policy silently.
# ---------------------------------------------------------------------------

# create_metric NAME DESCRIPTION LOG_FILTER VALUE_FIELD
create_metric() {
  local name="$1" description="$2" filter="$3" value_field="$4"

  if gcloud logging metrics describe "$name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "  = metric $name already exists"
    return 0
  fi

  echo "  + metric $name"
  local config
  config="$(mktemp)"
  cat > "$config" <<EOF
filter: |
  ${filter}
metricDescriptor:
  metricKind: DELTA
  valueType: INT64
  unit: "1"
  labels:
    - key: workspace_id
      valueType: STRING
      description: Workspace the counter was emitted for
valueExtractor: EXTRACT(jsonPayload.${value_field})
labelExtractors:
  workspace_id: EXTRACT(jsonPayload.workspaceId)
description: ${description}
EOF
  run gcloud logging metrics create "$name" \
    --config-from-file="$config" \
    --project="$PROJECT_ID"
  rm -f "$config"
}

echo "Log-based metrics:"

create_metric "slo_publish_attempted" \
  "Publishes attempted per workspace tick" \
  'jsonPayload.event="slo.publish"' \
  "publishAttempted"

create_metric "slo_publish_failed" \
  "Publishes that failed per workspace tick" \
  'jsonPayload.event="slo.publish"' \
  "publishFailed"

create_metric "slo_webhook_dead_lettered" \
  "Webhook deliveries given up on after the final attempt" \
  'jsonPayload.event="slo.webhook_delivery"' \
  "webhookDeadLettered"

create_metric "slo_metrics_overdue_posts" \
  "Published posts whose metrics poll is overdue beyond the grace window" \
  'jsonPayload.event="slo.metrics_staleness"' \
  "metricsOverduePosts"

create_metric "slo_ai_burn_percent" \
  "Percent of a workspace monthly AI allowance consumed" \
  'jsonPayload.event="slo.ai_burn"' \
  "aiBurnPercent"

create_metric "slo_channels_token_degraded" \
  "Connections running on a short-lived token after a failed long-lived exchange" \
  'jsonPayload.event="slo.channel_health"' \
  "channelsTokenDegraded"

# ---------------------------------------------------------------------------
# Alert policies
#
# MQL rather than the condition flags: three of the four are ratios or
# windowed rates that the flag form cannot express.
# ---------------------------------------------------------------------------

# create_policy DISPLAY_NAME MQL DOCUMENTATION
create_policy() {
  local display_name="$1" query="$2" documentation="$3"

  if gcloud alpha monitoring policies list \
      --project="$PROJECT_ID" \
      --filter="displayName='${display_name}'" \
      --format="value(name)" 2>/dev/null | grep -q .; then
    echo "  = policy '$display_name' already exists"
    return 0
  fi

  echo "  + policy '$display_name'"
  local config
  config="$(mktemp)"
  cat > "$config" <<EOF
{
  "displayName": "${display_name}",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "${display_name}",
      "conditionMonitoringQueryLanguage": {
        "query": "${query}",
        "duration": "0s"
      }
    }
  ],
  "documentation": {
    "content": "${documentation}",
    "mimeType": "text/markdown"
  },
  "notificationChannels": [$( [[ -n "$NOTIFICATION_CHANNEL" ]] && printf '"%s"' "$NOTIFICATION_CHANNEL" )],
  "enabled": true
}
EOF
  run gcloud alpha monitoring policies create \
    --policy-from-file="$config" \
    --project="$PROJECT_ID"
  rm -f "$config"
}

echo ""
echo "Alert policies:"

create_policy "Publish failure rate above 20%" \
  "fetch logging.googleapis.com/user/slo_publish_failed | align delta(30m) | every 5m | group_by [], [failed: sum(value.slo_publish_failed)] | join (fetch logging.googleapis.com/user/slo_publish_attempted | align delta(30m) | every 5m | group_by [], [attempted: sum(value.slo_publish_attempted)]) | value [ratio: val(0) / val(1)] | condition ratio > 0.2 '1'" \
  "More than a fifth of publish attempts failed in 30 minutes. Usually a platform API change or an expired app credential. Open the publishAttempts trail on a failing post for the platform's own error. See docs/operations/alerting.md."

create_policy "Webhook deliveries dead-lettering" \
  "fetch logging.googleapis.com/user/slo_webhook_dead_lettered | align delta(1h) | every 5m | group_by [], [dead: sum(value.slo_webhook_dead_lettered)] | condition dead > 5 '1'" \
  "Webhook deliveries are exhausting their retries. If one workspace dominates, their receiver is down; across workspaces, suspect our delivery path or the SSRF guard. Check GET /api/settings/webhook-endpoints/{id}/deliveries."

create_policy "Metrics poller staleness" \
  "fetch logging.googleapis.com/user/slo_metrics_overdue_posts | align delta(1h) | every 5m | group_by [metric.workspace_id], [overdue: max(value.slo_metrics_overdue_posts)] | condition overdue > 10 '1'" \
  "Published posts have stopped collecting metrics. Check whether the affected posts still have an externalId: an empty one on a published post is a code bug (see EH-01), not a platform outage."

create_policy "AI allowance burn rate" \
  "fetch logging.googleapis.com/user/slo_ai_burn_percent | align delta(1h) | every 10m | group_by [metric.workspace_id], [burn: max(value.slo_ai_burn_percent)] | condition burn > 80 '1'" \
  "A workspace has consumed over 80% of its monthly AI allowance. Compare against its intelligenceJobs volume: burn with no corresponding jobs is a retry loop."

echo ""
echo "Done. Verify with:"
echo "  gcloud logging metrics list --project=$PROJECT_ID"
echo "  gcloud alpha monitoring policies list --project=$PROJECT_ID"
echo ""
echo "Dashboard-only signals (deliberately not paged): slo_channels_token_degraded,"
echo "and OAuth connections entering error status per day. See docs/operations/alerting.md."
