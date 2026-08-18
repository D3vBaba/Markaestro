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

All current writers use Firestore `Timestamp`/`Date` values for `expiresAt`.
The OAuth reader also accepts the legacy ISO-string representation during a
rolling deployment, and the cleanup worker drains those legacy records.

Firestore can take up to roughly 24 hours to delete an expired document. Never
use physical presence as proof that a lease, state, or upload URL remains valid.
