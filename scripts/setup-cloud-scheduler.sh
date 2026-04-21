#!/usr/bin/env bash
# Setup Google Cloud Scheduler jobs that drive Markaestro's background work:
#   1. markaestro-worker-tick   — every 1 min, runs the full worker tick
#      (token refresh, scheduled posts, job runs, webhooks, and the default
#      TikTok publish poll).
#   2. markaestro-tiktok-poll   — every 1 min, runs a dedicated fast poll
#      for TikTok posts stuck in `publishing`. The endpoint itself polls
#      twice per invocation with a 30s gap, giving an effective ~30s
#      cadence for pending TikTok drafts without overloading the main tick.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - Cloud Scheduler API enabled: gcloud services enable cloudscheduler.googleapis.com
#   - WORKER_SECRET set in Google Secret Manager
#
# Usage:
#   ./scripts/setup-cloud-scheduler.sh <APP_URL> <WORKER_SECRET>
#
# Example:
#   ./scripts/setup-cloud-scheduler.sh https://markaestro--markaestro-0226220726.us-central1.hosted.app "your-worker-secret"

set -euo pipefail

APP_URL="${1:?Usage: $0 <APP_URL> <WORKER_SECRET>}"
WORKER_SECRET="${2:?Usage: $0 <APP_URL> <WORKER_SECRET>}"
PROJECT_ID="${PROJECT_ID:-markaestro-0226220726}"
REGION="${REGION:-us-central1}"

echo "Project: $PROJECT_ID"
echo "Region:  $REGION"
echo "App URL: $APP_URL"
echo ""

# create_or_replace JOB_NAME SCHEDULE URI_PATH ATTEMPT_DEADLINE DESCRIPTION
create_or_replace() {
  local job_name="$1"
  local schedule="$2"
  local uri_path="$3"
  local attempt_deadline="$4"
  local description="$5"

  if gcloud scheduler jobs describe "$job_name" --project="$PROJECT_ID" --location="$REGION" &>/dev/null; then
    echo "Deleting existing scheduler job '$job_name'..."
    gcloud scheduler jobs delete "$job_name" --project="$PROJECT_ID" --location="$REGION" --quiet
  fi

  echo "Creating scheduler job '$job_name' ($schedule → $uri_path)..."
  gcloud scheduler jobs create http "$job_name" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --schedule="$schedule" \
    --uri="${APP_URL}${uri_path}" \
    --http-method=POST \
    --headers="x-worker-secret=${WORKER_SECRET},Content-Type=application/json" \
    --message-body='{}' \
    --time-zone="UTC" \
    --attempt-deadline="$attempt_deadline" \
    --max-retry-attempts=3 \
    --min-backoff="10s" \
    --max-backoff="60s" \
    --description="$description"
}

create_or_replace \
  "markaestro-worker-tick" \
  "* * * * *" \
  "/api/worker/tick" \
  "120s" \
  "Triggers Markaestro background worker: token refresh, scheduled posts, jobs"

create_or_replace \
  "markaestro-tiktok-poll" \
  "* * * * *" \
  "/api/worker/tiktok-poll" \
  "120s" \
  "Fast poll for TikTok publishes pending in SEND_TO_USER_INBOX"

echo ""
echo "Cloud Scheduler jobs created successfully!"
echo "View in console: https://console.cloud.google.com/cloudscheduler?project=$PROJECT_ID"
echo ""
echo "To test manually:"
echo "  gcloud scheduler jobs run markaestro-worker-tick --location=$REGION"
echo "  gcloud scheduler jobs run markaestro-tiktok-poll --location=$REGION"
