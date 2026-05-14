# OAuth2 Server — Delegated Access for Third-Party Apps

## Why

Workspace API keys (`mk_live_<workspaceId>.<clientId>.<secret>`) assume the
integrator and the workspace owner are the same person. That blocks the
"Sign in with Markaestro" use case where a third-party app (e.g. an agency
tool, a Postiz competitor, an n8n custom node distributed publicly) wants
to act on behalf of arbitrary Markaestro users without those users
copy-pasting raw API keys. Adding an OAuth2 server unlocks that integrator
story.

This plan is meant to be reviewed and signed off before implementation
starts. Each "Decision" block calls out a product call that needs a
maker — defaults are noted but should be confirmed.

## Scope

In:
- App registration (developers create OAuth apps, get `client_id` + `client_secret`)
- Authorization Code grant with PKCE (RFC 7636)
- Refresh token rotation
- Consent screen UX
- Public API auth-layer accepts OAuth2 access tokens in addition to workspace API keys
- App-management UI (users see + revoke connected third-party apps)

Out (deferred):
- Implicit / device-code / client-credentials grants
- Dynamic client registration (RFC 7591) — manual registration only for v1
- Token introspection (RFC 7662) — not needed for first-party verification
- OpenID Connect / id_tokens — we're an OAuth2 provider, not an identity provider

## Token model

Three token types in play:

| Token | Format | Lifetime | Storage |
|---|---|---|---|
| Authorization code | random 32-byte url-safe | 60s, single-use | Firestore TTL doc |
| Access token | `mka_<workspaceId>.<grantId>.<secret>` | 1h | Hashed in Firestore (grants/{grantId}) |
| Refresh token | `mkr_<workspaceId>.<grantId>.<secret>` | 90 days, rotating | Hashed in Firestore |

**Decision 1 — token prefixes.** Postiz uses `pos_<token>`. Suggested:
`mka_` (access) and `mkr_` (refresh) so they're visually distinct from
API keys (`mk_live_`). Confirm or pick alternatives.

**Decision 2 — access token lifetime.** 1h is the GitHub/Slack norm.
Shorter (15m) is safer if a token leaks; longer (24h) is friendlier for
long-running automations that don't implement refresh. Default: 1h.

**Decision 3 — refresh rotation.** Suggested: rotate on every use, return
both new access + new refresh, mark old refresh as revoked. Detect reuse
of a revoked refresh token → revoke the entire grant chain (theft signal).
This is the OAuth2 BCP recommendation.

## Endpoints

### `GET /oauth2/authorize`

Query params: `response_type=code`, `client_id`, `redirect_uri`, `scope`,
`state`, `code_challenge`, `code_challenge_method=S256`.

Flow:
1. Validate `client_id` exists and is enabled
2. Validate `redirect_uri` matches one of the registered URIs exactly
   (no wildcards, no path appending)
3. If user not authenticated → redirect to `/login?next=...` and resume after
4. Render `/oauth2/consent` with: app name, app logo, requested scopes, the
   workspaces the user belongs to (user picks which workspace to grant access
   to), checkboxes per scope
5. On approve → create authorization code (60s TTL, single-use, bound to
   code_challenge + redirect_uri + scopes + workspaceId), redirect to
   `redirect_uri?code=...&state=...`
6. On deny → redirect to `redirect_uri?error=access_denied&state=...`

### `POST /oauth2/token`

Two grant types:

**`grant_type=authorization_code`** — initial exchange.
Body: `code`, `redirect_uri`, `client_id`, `client_secret`, `code_verifier`.
Validates the code is unused, unexpired, matches the PKCE verifier, matches
the redirect_uri, and the client credentials. Returns `{access_token,
refresh_token, expires_in, scope, token_type: "Bearer"}`.

**`grant_type=refresh_token`** — token rotation.
Body: `refresh_token`, `client_id`, `client_secret`. Returns a new
access+refresh pair and marks the old refresh as rotated. If a rotated
refresh is presented again → revoke the entire grant chain.

### `POST /oauth2/revoke`

RFC 7009. Body: `token` (access or refresh). Revokes the grant.

### `POST /oauth2/apps` and `GET /oauth2/apps` (in app, behind workspace auth)

Self-service app registration. Owner-only.
Body for create: `{name, logoUrl, homepageUrl, redirectUris[], scopes[]}`.
Returns `{clientId, clientSecret}` — secret shown once, then hashed.

**Decision 4 — app registration UX.** Two options:
- (a) Self-serve from Settings → Developers → OAuth apps (matches Stripe,
  Slack). Anyone with the `billing.manage` permission on a workspace can
  register an app. Easier dev story but risk of low-quality apps.
- (b) Admin-curated. Developers email `developers@markaestro.com` and we
  approve. Higher friction, higher quality.

Suggested: self-serve, mark apps as "unverified" until we review them, and
display the unverified badge prominently on the consent screen. Mirrors
GitHub.

### `GET /settings/connected-apps` (UI)

Workspace owner sees every OAuth app currently authorized on their
workspace + which scopes they have. One-click revoke.

## Data model (Firestore)

```
/oauth_apps/{appId}
  name, logoUrl, homepageUrl
  redirectUris: string[]
  scopes: string[]                     # max scopes this app may request
  clientId, clientSecretHash           # secret stored bcrypt-hashed
  ownerUid                             # registrar
  verified: boolean
  enabled: boolean
  createdAt, updatedAt

/workspaces/{workspaceId}/oauth_grants/{grantId}
  appId
  scopes: string[]                     # scopes actually granted (≤ app.scopes)
  grantedByUid
  refreshTokenHash, refreshTokenRotatedAt
  status: 'active' | 'revoked'
  lastUsedAt
  createdAt

/workspaces/{workspaceId}/oauth_grants/{grantId}/access_tokens/{tokenId}
  tokenHash
  expiresAt
  scopes: string[]

# Short-lived (cleared via TTL)
/oauth_codes/{code}
  appId, workspaceId, grantedByUid
  scopes, redirectUri
  codeChallenge, codeChallengeMethod
  expiresAt (TTL field, 60s)
```

**Decision 5 — workspace scoping at the grant level.** A grant is bound to
exactly one workspace. If a user wants to authorize the same app for two
workspaces, that's two grants. Alternative: single grant covers multiple
workspaces — more complex, mostly only matters for agency tools. Default:
one workspace per grant.

## Scope model

Suggested scopes (mirror the existing API-key scopes):

| Scope | Maps to |
|---|---|
| `products:read` | `products.read` |
| `media:write` | `media.write` |
| `posts:read` | `posts.read` |
| `posts:write` | `posts.write` |
| `posts:publish` | `posts.publish` |
| `runs:read` | `job_runs.read` |
| `webhooks:manage` | `webhooks.manage` |

Notation note: existing API keys use `posts.write` (dot) and this plan uses
`posts:write` (colon) per OAuth2 convention. Internally both map to the
same enforcement.

**Decision 6 — scope granularity.** Should we also add a coarse
`workspace:read` / `workspace:write` shorthand bundle to make consent
screens simpler for less technical users? Default: no — explicit per-scope
consent is safer.

## Auth-layer changes

`requirePublicApiContext` currently parses workspace API keys. Extend it to:

```ts
const authHeader = req.headers.get('authorization');
if (authHeader?.startsWith('Bearer mk_live_')) {
  return verifyApiKey(...);
}
if (authHeader?.startsWith('Bearer mka_')) {
  return verifyOAuth2AccessToken(...);
}
```

Both paths produce a `PublicApiContext`. The OAuth2 path sets
`principalType: 'oauth_app'`, `appId`, `grantId`, scopes from the grant
(not the app's max).

Rate limits and analytics already key on `clientId` — for OAuth2 we'll use
`appId:grantId` as the analytics key so per-app usage stats roll up.

## Consent screen

Renders inside `MarketingLayout` chrome:

- App name + logo + homepage link
- "Wants to access {workspaceName}" — workspace picker if user has multiple
- Scope list with per-scope plain-English descriptions
- Two buttons: Authorize / Cancel
- "Unverified app" warning banner where applicable

**Decision 7 — consent UX.** Single approve-all checkbox or per-scope
toggles? Slack does per-scope toggles for advanced; default-all-on works
for most. Default: default-on with the option to deselect.

## PKCE

Require PKCE (`code_challenge_method=S256`) for all flows, including
confidential clients. This is the OAuth2.1 direction and protects against
intercepted auth codes regardless of client secret hygiene.

## Rollout phases

| Phase | Deliverable | Effort |
|---|---|---|
| 1 | App registration UI + Firestore data model + admin verification flag | 1 day |
| 2 | `/oauth2/authorize` + consent screen | 1.5 days |
| 3 | `/oauth2/token` (code + refresh) with rotation | 1 day |
| 4 | Auth-layer accepts `mka_` tokens; per-scope enforcement | 0.5 day |
| 5 | `/oauth2/revoke` + connected-apps UI for workspace owners | 0.5 day |
| 6 | NodeJS SDK gains OAuth helpers; docs | 0.5 day |

Total: ~5 days of focused work assuming the seven decisions are made up
front. Larger if we discover token-storage encryption needs revisiting or
if Firebase Auth integration introduces friction.

## Open questions

1. **App branding review.** Do we want a manual review queue for "verified"
   apps (display green checkmark on consent screen) and how is that
   surfaced to developers?
2. **Per-app rate limits.** Currently rate-limited by `clientId`. For
   OAuth2 we might want per-app caps to prevent one viral app from
   monopolizing throughput.
3. **Webhook subscriptions under OAuth2.** Should an OAuth app register
   its own webhook destinations (per-app) or piggyback on workspace
   webhook subscriptions? Suggested: per-app, so revoking the grant
   automatically cleans up the app's webhook subscriptions.
4. **First-party vs third-party split.** Our own future iOS/CLI clients
   would also use this flow with `client_id` baked in. Should those skip
   the consent screen? Default: no, every OAuth flow shows consent.
