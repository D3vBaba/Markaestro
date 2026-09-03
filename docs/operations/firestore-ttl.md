# Firestore TTL policies

Ephemeral Firestore documents must use the platform TTL service so retry,
rate-limit, lease, and upload-session collections do not grow forever. The
application still rejects expired records because TTL deletion is eventual.

## Required policies

Apply one policy for every collection group below:

```bash
PROJECT_ID=markaestro-0226220726
DATABASE='(default)'

declare -a TTL_COLLECTIONS=(
  '_rateLimits'
  '_authOtps'
  'stripeWebhookEvents'
  'oauth_states'
  '_publishLocks'
  '_workerLeases'
  'idempotency_keys'
  'connect_upload_sessions'
  'upload_sessions'
  'webhook_deliveries'
  'job_runs'
  'tiktok_publish_mappings'
  'pendingInvites'
  'rawPlatformMetrics'
  'aiArtifacts'
  'conversionClicks'
  'publishAttempts'
  'oauth_clients'
  'oauth_codes'
  'oauth_refresh_tokens'
)

for collection in "${TTL_COLLECTIONS[@]}"; do
  gcloud firestore fields ttls update expiresAt \
    --collection-group="$collection" \
    --enable-ttl \
    --database="$DATABASE" \
    --project="$PROJECT_ID"
done
```

## Collection reference

| Collection group | Typical retention | Purpose |
| --- | ---: | --- |
| `_rateLimits` | 1–2 rate windows | Request and publish rate-limit buckets |
| `_authOtps` | 10 minutes | One-time sign-in and email-change codes |
| `stripeWebhookEvents` | 90 days | Stripe webhook replay protection |
| `oauth_states` | 10 minutes | OAuth state and PKCE verifier |
| `_publishLocks` | 5 minutes | Per-destination publish exclusion |
| `_workerLeases` | 2–5 minutes | Worker overlap protection |
| `idempotency_keys` | 24 hours | Public API replay records |
| `connect_upload_sessions` | 15 minutes | Single-use Connect upload URLs |
| `upload_sessions` | 15 minutes pending; 24 hours completed | Browser direct-upload sessions |
| `webhook_deliveries` | 30 days | Public webhook attempts and results |
| `job_runs` | 30 days | Publish and scheduled job history |
| `tiktok_publish_mappings` | 17 days active; 7 days terminal | TikTok webhook lookup and due-poll queue |
| `pendingInvites` | 30 days | Workspace invitations |
| `rawPlatformMetrics` | 90 days | Metadata pointers and checksums for immutable compressed platform payloads |
| `aiArtifacts` | 30 days | Validated AI response artifacts used for audit and repair diagnostics |
| `conversionClicks` | 90 days | Opaque click identifiers retained beyond the default attribution window |
| `publishAttempts` | 90 days | Per-channel, per-attempt publish outcomes behind the coarser `job_runs` summary |
| `oauth_clients` | 180 days since last token exchange | Dynamically registered MCP clients (agent OAuth) |
| `oauth_codes` | 10 minutes | Single-use authorization codes, stored hashed |
| `oauth_refresh_tokens` | 90 days | Rotating refresh tokens for connected agents, stored hashed |

Raw metric objects live under
`workspaces/{workspaceId}/private-intelligence/raw-platform-metrics/`. Configure
a Cloud Storage lifecycle rule that deletes this prefix after 90 days;
Firestore TTL removes the pointer but does not delete its Storage object.
Direct client reads remain denied by `storage.rules`.

All current writers use Firestore `Timestamp`/`Date` values for `expiresAt`.
The OAuth reader also accepts the legacy ISO-string representation during a
rolling deployment, and the cleanup worker drains those legacy records.

Firestore can take up to roughly 24 hours to delete an expired document. Never
use physical presence as proof that a lease, state, or upload URL remains valid.
