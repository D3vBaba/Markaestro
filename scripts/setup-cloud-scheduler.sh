#!/usr/bin/env bash
# Setup Google Cloud Scheduler to trigger the worker tick endpoint every 2 minutes.
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
JOB_NAME="markaestro-worker-tick"

echo "Project:  $PROJECT_ID"
echo "Region:   $REGION"
echo "App URL:  $APP_URL"
echo "Job Name: $JOB_NAME"
echo ""

# Delete existing job if it exists (idempotent setup)
if gcloud scheduler jobs describe "$JOB_NAME" --project="$PROJECT_ID" --location="$REGION" &>/dev/null; then
  echo "Deleting existing scheduler job..."
  gcloud scheduler jobs delete "$JOB_NAME" --project="$PROJECT_ID" --location="$REGION" --quiet
fi

echo "Creating Cloud Scheduler job (every 2 minutes)..."
gcloud scheduler jobs create http "$JOB_NAME" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --schedule="*/2 * * * *" \
  --uri="${APP_URL}/api/worker/tick" \
  --http-method=POST \
  --headers="x-worker-secret=${WORKER_SECRET},Content-Type=application/json" \
  --message-body='{}' \
  --time-zone="UTC" \
  --attempt-deadline="120s" \
  --max-retry-attempts=3 \
  --min-backoff="10s" \
  --max-backoff="60s" \
  --description="Triggers Markaestro background worker: token refresh, scheduled posts, jobs"

echo ""
echo "Cloud Scheduler job created successfully!"
echo "View in console: https://console.cloud.google.com/cloudscheduler?project=$PROJECT_ID"
echo ""
echo "To test manually:"
echo "  gcloud scheduler jobs run $JOB_NAME --location=$REGION"
