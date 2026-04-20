# Markaestro Operations Runbooks

One document covering the four incidents/maintenance events most likely
to wake someone up. Each runbook assumes you have:

- `gcloud` CLI authenticated against the production project
- `firebase` CLI authenticated as an owner of the Firebase project
- Stripe CLI (`stripe`) with live API key in `STRIPE_SECRET_KEY`
- `kubectl`-style access to Cloud Run logs (`gcloud run services logs read`)

The production project id is assumed to be `PROJECT_ID`. Substitute as needed.

---

## 1. Secret rotation

Applies to: `DATA_ENCRYPTION_KEY`, `SESSION_SIGNING_KEY`, `WORKER_SECRET`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, OAuth client secrets,
`RESEND_API_KEY`, `SERPER_API_KEY`, AI provider keys.

### Why you might be rotating

- Quarterly rotation policy
- Suspected key leak (ex-employee, CI log, GitHub secret scan alert)
- Vendor compromise (e.g. Stripe rotates signing secret)

### Procedure

1. **Generate the new secret** and add it as a **new version** in Secret
   Manager. Do not disable the previous version yet.

   ```bash
   openssl rand -base64 48 | \
     gcloud secrets versions add DATA_ENCRYPTION_KEY --data-file=- --project="$PROJECT_ID"
   ```

2. **Decide on the deploy strategy.** Markaestro supports overlapping keys
   for the two envelope secrets:

   - `DATA_ENCRYPTION_KEY` — used by `src/lib/crypto.ts` for
     AES-256-GCM. The current reader also falls back to
     `ENCRYPTION_KEY` and `WORKER_SECRET`. To rotate without downtime:
     1. Add new value under `DATA_ENCRYPTION_KEY`.
     2. Keep old value under `ENCRYPTION_KEY` for one deploy window.
     3. Run the re-encryption script (see §1.4) for any data that was
        written with the previous key.
     4. Remove `ENCRYPTION_KEY` on the next deploy.

   - `SESSION_SIGNING_KEY` — used by `src/lib/session-cookie.ts`.
     The reader still accepts `ENCRYPTION_KEY` / `WORKER_SECRET` for one
     deploy window. Sessions signed with the old key will be accepted
     until they expire or `revokeRefreshTokens` is called.

   For the remaining secrets (Stripe, OAuth, etc.), rotation is a hard
   swap: update the secret, redeploy, revoke old key at the provider.

3. **Redeploy** App Hosting so the new Cloud Run revision picks up the new
   secret version:

   ```bash
   cd maerkestro
   firebase deploy --only apphosting --project "$PROJECT_ID"
   ```

4. **Re-encrypt at-rest data** if `DATA_ENCRYPTION_KEY` changed. The known
   at-rest ciphertexts are:

   - `workspaces/{id}/integrations/{provider}.tokens.accessToken / .refreshToken`
   - `workspaces/{id}/api-clients/{id}.hashedSecret` (hashes — no re-encrypt)
   - `stripeWebhookEvents` (idempotency markers — TTL will roll them over)

   For the `integrations` collection, run:

   ```bash
   node scripts/rotate-encryption-key.mjs --dry-run
   node scripts/rotate-encryption-key.mjs
   ```

   *(The script is not committed yet; when you need it, adapt
   `scripts/sync-stripe-prices.mjs` as a template and use `crypto.ts`
   `encrypt/decrypt`.)*

5. **Disable the old Secret Manager version** only after a full 24h of
   green runtime metrics.

   ```bash
   gcloud secrets versions disable <N-1> --secret=DATA_ENCRYPTION_KEY --project="$PROJECT_ID"
   ```

6. **Invalidate sessions** if the rotation is due to suspected leak:

   ```bash
   # Nuclear option — logs every user out.
   node scripts/revoke-all-sessions.mjs
   ```

### Post-mortem checklist

- [ ] Secret Manager now has exactly one enabled version for each key
- [ ] `gcloud secrets versions list` shows the disabled old version
- [ ] `/api/health?deep=1` returns green
- [ ] Sentry shows no spike in `decrypt` / `verifySession` failures
- [ ] If leak-driven: users were notified, audit log attached to ticket

---

## 2. Stripe webhook replay

Applies to: `/api/stripe/webhook`.

### When to replay

- A Cloud Run outage caused the webhook to return 5xx for a window —
  Stripe will retry for up to 3 days, but you want convergence faster.
- A bug caused the handler to succeed (200 OK) without actually writing
  the subscription state. You shipped a fix and need to rehydrate.
- Migrating a customer from uid-keyed to workspace-keyed
  subscriptions and want fresh canonical data.

### Procedure

1. **Find the event(s) you need.** In the Stripe dashboard or via CLI:

   ```bash
   stripe events list --limit 50 --type customer.subscription.updated
   stripe events retrieve evt_XXXX
   ```

2. **Clear the idempotency marker** so the handler will actually process
   the event instead of short-circuiting on the prior completion:

   ```bash
   gcloud firestore documents delete \
     "stripeWebhookEvents/evt_XXXX" --project="$PROJECT_ID"
   ```

   For bulk clears, the `stripeWebhookEvents` collection has a TTL index
   (7 days) — you can also just wait.

3. **Replay via the Stripe CLI** against production:

   ```bash
   stripe events resend evt_XXXX --live
   ```

   Or replay many events at once by piping:

   ```bash
   stripe events list --limit 100 --type invoice.paid | \
     jq -r '.data[].id' | xargs -I{} stripe events resend {} --live
   ```

4. **Verify convergence.** The webhook logs `stripe.webhook.*` events
   with the structured logger. Filter Cloud Run logs:

   ```bash
   gcloud run services logs read markaestro \
     --limit 200 \
     --project "$PROJECT_ID" | grep 'stripe.webhook'
   ```

5. **For webhook-secret rotation specifically**, replay is *not* needed —
   Stripe signs with the active secret. See §1 for rotation.

### Pitfalls

- **Never replay `customer.subscription.deleted`** for a resurrected
  customer — the handler will mark the subscription `canceled`. Instead,
  use the Stripe dashboard to uncancel, then let the
  `customer.subscription.updated` event flow normally.
- The idempotency check is a Firestore transaction; replay while a
  concurrent live event is flowing is safe — one will win and the other
  will no-op.

---

## 3. Firestore index / query breakage

Applies to: any query that shows up in Cloud Logging as
`FAILED_PRECONDITION: The query requires an index`.

### Procedure

1. **Identify the failing query.** The error message includes a direct
   console link to pre-fill the index definition. Capture it from:

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" AND textPayload:"requires an index"' \
     --limit 20 --project "$PROJECT_ID"
   ```

2. **Add the index** to `firestore.indexes.json`. This is the source of
   truth — clicking the console link creates a one-off index that is not
   version-controlled, which inevitably drifts.

   Example pattern:

   ```json
   {
     "collectionGroup": "posts",
     "queryScope": "COLLECTION",
     "fields": [
       { "fieldPath": "workspaceId", "order": "ASCENDING" },
       { "fieldPath": "status", "order": "ASCENDING" },
       { "fieldPath": "scheduledAt", "order": "ASCENDING" }
     ]
   }
   ```

3. **Validate locally:**

   ```bash
   npm run validate:queries
   ```

   This script walks every `adminDb.collection(...).where(...)` call in
   the codebase and asserts a matching index is declared. PRs without
   it will fail CI.

4. **Deploy the index:**

   ```bash
   firebase deploy --only firestore:indexes --project "$PROJECT_ID"
   ```

   Index builds are async. For large collections (> 1M docs), expect
   minutes-to-hours. Meanwhile, the query keeps failing.

5. **Temporary mitigation while the index builds:** disable the
   affected feature behind a feature flag or fall back to a simpler
   unindexed query. Do not ship a workaround that skips authorization.

### Backfill

If the index is on a new field, existing documents won't have it. Use
the backfill pattern from `scripts/backfill-workspace-subscriptions.mjs`
as a template:

- Walk the collection in pages of 500
- For each doc, write the new field (ideally via `FieldValue.increment`
  or a merge-write so you don't clobber concurrent writes)
- Run `--dry-run` first, then commit

### When to drop a stale index

Firestore charges storage for every index. Drop indexes you removed
from code:

```bash
firebase firestore:indexes --project "$PROJECT_ID"   # list active
firebase firestore:indexes:delete --project "$PROJECT_ID"
```

Do this during a maintenance window — dropping an index is instant
but reintroducing it requires a rebuild.

---

## 4. OAuth provider breakage

Applies to: Google, Facebook/Instagram/Meta, TikTok, X/Twitter, LinkedIn,
Pinterest. "Breakage" means either a provider-side outage or a
misconfigured redirect URI / scopes after a provider policy change.

### Triage

1. **Where is the failure?**

   - **`/api/oauth/authorize/{provider}`** returns 500 → our server
     can't build the provider URL. Check env vars
     `{PROVIDER}_CLIENT_ID`, redirect URI, scope list.
   - **Provider consent screen shows an error** → misconfiguration on
     the provider console (redirect URI, verified domain, scopes pending
     review).
   - **`/api/oauth/callback/{provider}`** returns 4xx → our token
     exchange failed. Check client secret, code verifier (for PKCE),
     state cookie.
   - **`/api/oauth/callback/{provider}`** returns 2xx but the user lands
     on `/oauth/complete` without a connected integration → the token
     persisted but decryption or scope grant failed. Check
     `DATA_ENCRYPTION_KEY` (§1) and `integrations/{provider}.status`.

2. **Grab the structured log:**

   ```bash
   gcloud run services logs read markaestro \
     --limit 500 --project "$PROJECT_ID" | grep -E 'oauth.(authorize|callback)'
   ```

### Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `redirect_uri_mismatch` | Deployed app URL doesn't match provider console | Update `NEXT_PUBLIC_APP_URL` or add the new redirect URI in the provider console |
| `invalid_client` | Client secret rotated upstream | Fetch the new one, update Secret Manager (§1), redeploy |
| `scope_denied` | Provider revoked a scope / user declined | Show a friendlier reconnect CTA; do not retry automatically |
| Callback hangs forever | `state` cookie lost (SameSite=None + no HTTPS in dev) | Only an issue in local dev; ensure `NEXT_PUBLIC_APP_URL` is `https://` in prod |
| `user_denied` | User hit "cancel" on the consent screen | No server-side action; surface a toast |

### Rolling rollback

If a recent deploy broke OAuth (new scopes, changed redirect URI):

```bash
gcloud run revisions list --service=markaestro --project="$PROJECT_ID"
gcloud run services update-traffic markaestro \
  --to-revisions=<previous-good-revision>=100 \
  --project="$PROJECT_ID"
```

This is a traffic shift, not a code revert — it's instant. Follow up
with a real fix and forward-deploy.

### Reconnecting affected users

When a provider rotates tokens or revokes our app (e.g. Meta's
annual reauth), a wave of users will see a "connection lost" badge.
There is no silent recovery:

1. Email the affected cohort with the /settings deep link.
2. Our `/api/oauth/authorize/{provider}` supports `?next=/settings`
   which survives the §4 `safe-next` guard.
3. Monitor `integrations/*` documents for `status === 'error'` to
   measure re-connect rate.

### Full recreate

If a provider app is catastrophically blocked:

1. Create a new OAuth app in the provider's console.
2. Add it to Secret Manager under a new secret name (e.g.
   `META_CLIENT_ID_V2`).
3. Ship a deploy that reads the new secret.
4. Email all affected users — their stored refresh tokens are now
   tied to the old provider app and will fail on next refresh.
5. On successful reconnection, delete the old provider app in a
   follow-up deploy.

---

## Appendix — Paging chain

1. `@on-call-primary` in PagerDuty (Cloud Run uptime + Sentry)
2. `@on-call-secondary` after 15 min
3. `@founder` for anything `status: past_due` on more than 1% of
   workspaces or data-loss incidents

Keep this file updated. Every real incident should result in either a
new runbook entry or an amendment here.
