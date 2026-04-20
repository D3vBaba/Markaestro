# Firestore TTL policies

Several Firestore collections are ephemeral and grow unbounded without
active cleanup. We use Firestore's built-in **TTL policy** feature
(expiry based on a timestamp field) rather than scheduler-driven
deletes because it is free, consistent, and drops load off the worker.

## Required TTL policies

Configure one policy per collection via the Cloud Console
(Firestore → Indexes → TTL tab) or via gcloud:

```bash
PROJECT_ID=markaestro-0226220726
DB=(default)

declare -a TTL_SPECS=(
  "_rateLimits:expiresAt"
  "stripeWebhookEvents:expiresAt"
  "_oauthStates:expiresAt"
  "_publishThrottle:expiresAt"
  "_idempotency:expiresAt"
  "_researchCache:expiresAt"
  "_sceneCache:expiresAt"
)

for spec in "${TTL_SPECS[@]}"; do
  IFS=':' read -r collection field <<< "$spec"
  gcloud firestore fields ttls update "$field" \
    --collection-group="$collection" \
    --enable-ttl \
    --database="$DB" \
    --project="$PROJECT_ID"
done

# Per-workspace pending invites live in a subcollection, so configure
# the TTL on the subcollection group:
gcloud firestore fields ttls update expiresAt \
  --collection-group=pendingInvites \
  --enable-ttl \
  --database="$DB" \
  --project="$PROJECT_ID"
```

## Notes

- Firestore TTL deletes documents *eventually* — up to 24h after
  expiry. Code that reads these collections must treat expired
  documents as invalid even if still present (see
  `server-auth.acceptPendingInvites` for the reference pattern).
- TTL is charged as a single delete per document (same as a normal
  delete), but without invoking any listeners.
- The field must be a Firestore `Timestamp` (not a string). The code
  in this repo writes `new Date(...)` which the SDK serializes to
  a Timestamp correctly.

## Collection reference

| Collection              | Field       | Typical retention | Writer                                  |
| ----------------------- | ----------- | ----------------- | --------------------------------------- |
| `_rateLimits`           | `expiresAt` | 1–2 windows       | `src/lib/rate-limit.ts`                 |
| `stripeWebhookEvents`   | `expiresAt` | 90d               | `src/app/api/stripe/webhook/route.ts`   |
| `_oauthStates`          | `expiresAt` | 10 min            | `src/lib/oauth/flow.ts`                 |
| `_publishThrottle`      | `expiresAt` | per provider rate | `src/lib/public-api/publish-throttle.ts`|
| `_idempotency`          | `expiresAt` | 24h               | `src/lib/public-api/idempotency.ts`     |
| `_researchCache`        | `expiresAt` | 7d                | `src/lib/ai/research-cache.ts`          |
| `_sceneCache`           | `expiresAt` | 7d                | `src/lib/ai/image-scene-interpreter.ts` |
| `pendingInvites` (CG)   | `expiresAt` | 30d               | `src/app/api/team/route.ts`             |
