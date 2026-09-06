# Agent Connect: Per-Client Onboarding on /developers/agents

Status: draft for review, 2026-09-05. Nothing in this document is implemented.

## Why

`/developers/agents` explains the hosted MCP server and the OAuth flow well,
but it only shows a working install path for Claude Code. A user on Cursor,
ChatGPT, Grok, Grok Bot, OpenClaw, or Hermes has to translate a generic
`mcpServers` JSON block into their client's own config format, guess whether
their client can do the browser sign-in or needs a key, and then guess where
in the client the sign-in button is. The page is a reference; it needs to be
an onboarding surface where a user picks their agent and follows three steps.

Two of the six requested clients also cannot connect today without small
protocol changes on our side (grok.com wants a pre-registered OAuth client;
ChatGPT sends RFC 8707 `resource` and prefers RFC 9207 `iss`). Those are in
scope here because the page is only "actually usable" if the flow behind the
snippet completes.

## Assumptions

- "Grokbot" means xAI's **Grok Bot** (persistent cloud agents, launched
  2026-08-11, early beta), distinct from grok.com chat, Grok Build (the
  terminal CLI), and the xAI API. All four Grok surfaces are covered because
  a user saying "Grok" can mean any of them.
- The hosted endpoint `https://markaestro.com/api/public/v1/mcp` stays the
  single server for every client. No per-client servers.
- Every client gets one of two paths: **browser sign-in** (OAuth 2.1, PKCE,
  DCR; the token is a brand-bound API key) or **static key** (a workspace
  API key from Settings, API, passed as a header). The page must say which
  path each client uses and why.

## What exists today (verified in code)

| Piece | Where | State |
| --- | --- | --- |
| Marketing page | `src/app/[locale]/(marketing)/developers/agents/page.tsx` (815 lines, server component) | Sections: hero, why, MCP (Claude Code + generic JSON + headless), loop, quickstart, tool defs, recipes, guardrails, errors, stacks, CTA |
| Copy | `src/messages/{11 locales}/developersAgents.json` | 186 leaf strings, all locales at parity |
| Hosted MCP | `src/app/api/public/v1/mcp/route.ts` | Stateless Streamable HTTP, 401 + `WWW-Authenticate` challenge, `x-markaestro-read-only: 1` |
| OAuth server | `src/lib/agent-oauth/*`, `src/app/api/public/v1/oauth/{register,token,revoke}`, `src/app/(app)/oauth/authorize/page.tsx`, `src/app/api/oauth/agent/{consent,client}` | PKCE S256, DCR (RFC 7591), refresh rotation, `none` / `client_secret_post` / `client_secret_basic` |
| Discovery | `src/app/.well-known/oauth-{protected-resource,authorization-server}/[[...path]]/route.ts` | Root and path-suffixed variants, CORS `*`, cached 1h |
| Redirect policy | `src/lib/agent-oauth/redirect-uri.ts` | https, loopback http (any port), custom schemes (`cursor://`) |
| Not handled | `resource` (RFC 8707) is read into the token body and ignored; no `iss` in the authorization response; no CIMD; only `Authorization: Bearer` is accepted (`src/lib/public-api/auth.ts:131`) |
| Rate limit on DCR | `register/route.ts` uses `RATE_LIMITS.auth` = 10 req/min per IP | Hosted clients (ChatGPT, grok.com, claude.ai) register from shared egress IPs |
| Client TTL | `oauth_clients` idle TTL 180 days (`store.ts`) | Fine for DCR; a first-party pre-registered client must not expire |
| Proxy | `hosting-proxy/server.js` response-header allowlist | Already forwards `www-authenticate`, `mcp-*`, CORS, rate-limit headers |
| Distribution | `mcp/README.md`, `plugin/README.md`, `skills/markaestro/SKILL.md`, `public/llms.txt`, `docs/PUBLIC_API.md` | All Claude Code centric (`/mcp`, `claude mcp add`) |

## Client matrix (research, 2026-09-05)

| Client | How it takes an MCP server | Sign-in path | Works today? | Gap |
| --- | --- | --- | --- | --- |
| Claude Code | plugin or `claude mcp add --transport http` | OAuth | Yes (verified live 2026-09-03 up to the sign-in prompt) | None |
| claude.ai / Claude Desktop | Settings, Connectors, Add custom connector, URL | OAuth (https redirect) | Expected yes | Untested by us |
| **Cursor** | `~/.cursor/mcp.json` or `.cursor/mcp.json`: `{"mcpServers":{"markaestro":{"url":"..."}}}`; one-click deeplink `cursor://anysphere.cursor-deeplink/mcp/install?name=...&config=<base64>`; browser opens on first tool call; tokens in OS keychain | OAuth (`cursor://` redirect, already allowed) | Expected yes | Add the deeplink button and the exact settings path (Cursor Settings, Tools & MCP, "Needs login") |
| **ChatGPT** | Settings, Apps & Connectors, Advanced settings, Developer mode; then Create, name + URL, Auth: OAuth, Scan Tools. Custom connectors need Pro (read-only tools) or Business / Enterprise / Edu (all tools). Public HTTPS only. | OAuth. Sends `resource=` on authorize and token (RFC 8707). Prefers CIMD (`client_id` = `https://chatgpt.com/oauth/client.json`), falls back to DCR when `registration_endpoint` is advertised. Redirect `https://chatgpt.com/connector/oauth/{callback_id}`, or the stable `https://chatgpt.com/connector_platform_oauth_redirect` when the AS returns `iss` (RFC 9207). | Probably yes via DCR (resource is ignored, not rejected) | Validate `resource`; add `iss`; CIMD optional; DCR IP rate limit |
| **Grok (grok.com)** | grok.com/connectors, New Connector, Custom, URL, auth. Business / Enterprise need an admin to provision. | OAuth, but the dialog asks for a **Client ID** (public, PKCE S256, blank secret) rather than doing DCR (per third-party setup guides; confirm on a real account) | No | Pre-register a first-party public client with xAI's redirect URI and print its id on the page |
| **Grok Build (CLI)** | `grok mcp add --transport http markaestro <url>`; `~/.grok/config.toml`; also merges Claude's `.mcp.json` and `.cursor/mcp.json`; `grok mcp doctor` | OAuth ("servers that require OAuth trigger a browser flow on first use"), or `--header` | Expected yes | Document it; plugin users get it for free via `.mcp.json` |
| **xAI API (Responses API / native SDK)** | tool `{ "type": "mcp", "server_url", "server_label", "authorization", "allowed_tools" }` | Static key only (server-side, no browser) | Yes | Document it with the key path |
| **Grok Bot** | Custom MCP through Grok connector settings; beta has **no interactive OAuth** for custom servers, uses a setup token / API key header (guides mention `x-api-key`) | Static key | Unclear | Confirm header name; if only `x-api-key` is possible, accept it as an alias on the MCP route |
| **OpenClaw** | `openclaw mcp add markaestro --url <url> --transport streamable-http --auth oauth` then `openclaw mcp login markaestro` (loopback listener, `--code` fallback for headless); or `--header "Authorization: Bearer ${MARKAESTRO_API_KEY}"`; config in `~/.openclaw/openclaw.json` under `mcp.servers`; also installs skills from ClawHub (`openclaw skills install <slug>`) | OAuth (loopback) or static key | Expected yes | Document; publish the skill to ClawHub |
| **Hermes Agent** | `~/.hermes/config.yaml` `mcp_servers.markaestro: { url, auth: oauth }` or `headers: { Authorization: "Bearer ${MARKAESTRO_API_KEY}" }` with the secret in `~/.hermes/.env`; `/reload-mcp`; tools appear as `mcp_markaestro_<tool>`; skills install from a URL or the official hub | OAuth (PKCE, tokens in `~/.hermes/mcp-tokens/`) or static key | Expected yes | Document; make the skill installable by URL |

## Deliverable 1: the page

### 1a. New "Connect Your Agent" section (replaces the current MCP install cards)

Keep the section id `#connect-mcp` (linked from the hero button and from
llms.txt) but rebuild its top half as a client picker.

- **Component**: `src/components/marketing/AgentConnectTabs.tsx`, a client
  component built on `src/components/ui/tabs.tsx`. The page stays a server
  component; only the tab strip is interactive.
- **Tabs** (in this order, each with a short text label, no third-party
  logos): Claude Code, Claude (claude.ai and Desktop), Cursor, ChatGPT, Grok,
  Grok Bot, OpenClaw, Hermes, Other MCP client, Headless / API key.
- **Grok tab** has three sub-blocks: grok.com, Grok Build CLI, xAI API.
- **Deep links**: `?client=cursor` selects a tab on load and each tab
  updates the hash (`#connect-cursor`) so docs, llms.txt, and support can
  link straight to one client. Read `useSearchParams` inside the component
  (wrap in `Suspense`).
- **Every panel has the same four blocks**, so a user can scan:
  1. *Before you start*: plan or mode requirement (ChatGPT Developer mode and
     plan tier, Grok Business admin provisioning, Grok Bot beta), and
     "you must be a workspace owner or admin with a verified email".
  2. *Add the server*: the one-click button where the client has one
     (Cursor deeplink; VS Code / Claude Code have CLI lines instead), plus a
     `CopyBlock` with the client's own config format.
  3. *Sign in*: where the client shows the sign-in prompt and what the
     consent page asks (workspace, brand, permissions). For static-key
     clients: link to Settings, API with the scope preset (see 1d).
  4. *Verify*: "ask the agent to call `list_products`" and "the connection
     appears in Settings, API as a Connected agent". Link to
     `/settings?tab=api`.
- **Static-key callout** on every panel that supports both paths: "Prefer the
  sign-in. Use a key only where the client cannot open a browser."
- The existing flow explainer (five steps), facts, and endpoint reference
  stay below the tabs unchanged.

### 1b. Snippets (single source of truth)

Move all connection snippets out of `page.tsx` into
`src/lib/agent-connect/clients.ts` exporting a typed list:

```ts
type AgentClient = {
  id: 'claude-code' | 'claude' | 'cursor' | 'chatgpt' | 'grok' | 'grok-bot' | 'openclaw' | 'hermes' | 'generic' | 'headless';
  auth: 'oauth' | 'key' | 'both';
  install: Array<{ label: string; code: string; kind: 'bash' | 'json' | 'yaml' | 'toml' | 'steps' }>;
  deeplink?: string;
};
```

The page, `public/llms.txt`, the skill, and the READMEs can then be
generated from or checked against the same constants (a `docs:check` style
script is optional; at minimum the page imports them). Snippets are
untranslated by design, as today.

Exact snippets to ship:

- **Cursor** deeplink (config is the base64 of `{"url":"https://markaestro.com/api/public/v1/mcp"}`):

  ```text
  cursor://anysphere.cursor-deeplink/mcp/install?name=markaestro&config=eyJ1cmwiOiJodHRwczovL21hcmthZXN0cm8uY29tL2FwaS9wdWJsaWMvdjEvbWNwIn0=
  ```

  and `.cursor/mcp.json`:

  ```json
  { "mcpServers": { "markaestro": { "url": "https://markaestro.com/api/public/v1/mcp" } } }
  ```

  Render the deeplink as a real anchor (an `<a href="cursor://...">`), not a
  copy block, and keep the JSON as the fallback. Verify the button opens
  Cursor and lands the server in Tools & MCP before shipping.

- **ChatGPT**: no config file; the panel is steps. Settings, Apps &
  Connectors, Advanced settings, turn on Developer mode. Create, name
  "Markaestro", URL, Authentication: OAuth, Scan Tools (sign in when the
  browser opens), Create. In a chat: plus, More, Markaestro. State the plan
  requirement plainly.

- **grok.com**: grok.com/connectors, New Connector, Custom, URL. If the
  dialog asks for a client id: `markaestro-grok-web` (see Deliverable 2c),
  leave the secret blank, PKCE S256.

- **Grok Build**:

  ```bash
  grok mcp add --transport http markaestro https://markaestro.com/api/public/v1/mcp
  grok mcp doctor markaestro
  # Headless:
  grok mcp add --transport http markaestro https://markaestro.com/api/public/v1/mcp \
    --header "Authorization: Bearer ${MARKAESTRO_API_KEY}"
  ```

- **xAI API**:

  ```json
  { "type": "mcp", "server_url": "https://markaestro.com/api/public/v1/mcp",
    "server_label": "markaestro", "authorization": "Bearer mk_live_...",
    "allowed_tools": ["list_products", "list_destinations", "create_post", "publish_post", "get_job_run"] }
  ```

- **Grok Bot**: steps into the connector settings, then the key header.
  Header name to be confirmed on a real account (see 2d).

- **OpenClaw**:

  ```bash
  openclaw mcp add markaestro \
    --url https://markaestro.com/api/public/v1/mcp \
    --transport streamable-http --auth oauth
  openclaw mcp login markaestro          # prints the URL; use --code <code> when headless
  openclaw mcp reload
  # Skill (after ClawHub publish):
  openclaw skills install markaestro
  ```

  plus the `openclaw.json` shape (`mcp.servers.markaestro` with
  `auth: "oauth"`), and the header variant with `${MARKAESTRO_API_KEY}`.

- **Hermes**:

  ```yaml
  # ~/.hermes/config.yaml
  mcp_servers:
    markaestro:
      url: "https://markaestro.com/api/public/v1/mcp"
      auth: oauth
  # Headless: replace auth with
  #     headers: { Authorization: "Bearer ${MARKAESTRO_API_KEY}" }   # secret in ~/.hermes/.env
  ```

  then `/reload-mcp`; tools appear as `mcp_markaestro_*`.

- **Claude Code**, **generic JSON**, **headless**: keep the existing three
  snippets.

### 1c. Copy changes (`developersAgents.json`, all 11 locales)

- Hero `intro1`, meta `description`, `stacks.items[2]` (MCP clients) and the
  CTA subtitle: name the supported clients (Claude Code, Claude, Cursor,
  ChatGPT, Grok, Grok Bot, OpenClaw, Hermes) instead of the current four.
- New namespace `connect`: tab labels, the four block titles, per-client
  prerequisite and step prose, the static-key callout, the verify line.
  Roughly 60 to 80 new strings. Snippets and client product names are
  not translated.
- Title Case for tab labels, block titles, and buttons; sentence case for
  the step prose. No em dashes, no sparkle icon (`npm run copy:check`).
- Translate the new keys into the 10 other locales in the same change so
  `node scripts/check-i18n.mjs` stays at key-shape parity (it is not in CI,
  but the file set is currently at parity and should stay that way).

### 1d. Settings, API preset for headless keys

Add `?tab=api&preset=agent` to the settings page so the "Create an API Key"
links from the static-key panels land on the create form with the
`DEFAULT_AGENT_SCOPES` pre-ticked and a 90-day expiry suggested. Small
change in `src/app/(app)/settings/page.tsx` (ApiAccessTab). Optional but it
removes the "which scopes?" question for OpenClaw, Hermes, Grok Bot, and
the xAI API.

## Deliverable 2: protocol changes so the flow completes

All in `src/lib/agent-oauth/` and the OAuth routes, each with unit tests next
to the existing `__tests__` and `oauth-routes.test.ts`.

### 2a. RFC 8707 `resource` (ChatGPT sends it; harmless to others)

- `metadata.ts`: export `canonicalResource(origin)` returning
  `${origin}/api/public/v1/mcp`.
- Consent page and `api/oauth/agent/consent`: read `resource` from the
  request; when present it must equal the canonical resource for the
  request origin (also accept the app-origin form when
  `APP_DOMAIN_SPLIT_ENABLED`), else redirect with `error=invalid_target`.
  Store the value on the authorization code record.
- `grants.ts`: token exchange and refresh accept `resource`; mismatch with
  the stored value is `invalid_target`. Absent is fine (Claude Code, Cursor).
- No audience claim is needed: the access token is an API key that only
  works on this host.

### 2b. RFC 9207 `iss` on the authorization response

- `consent/route.ts`: append `iss=<issuer origin>` to the success redirect
  and to error redirects.
- `metadata.ts`: `authorization_response_iss_parameter_supported: true`.
- Lets ChatGPT use its stable redirect URI; no other client is affected.

### 2c. First-party pre-registered public client for grok.com

- Seed script `scripts/seed-oauth-clients.mjs` (idempotent) writing
  `oauth_clients/markaestro-grok-web` with xAI's redirect URI(s), grant
  types `authorization_code` + `refresh_token`, auth method `none`, and **no
  `expiresAt`** (first-party). `getOAuthClient` already treats a missing
  expiry as valid; confirm and add a test.
- Add a `firstParty: true` flag so `touchOAuthClient` never sets a TTL on it
  and Settings can label the connection "Grok".
- The exact redirect URI comes from the grok.com connector dialog or xAI
  docs; capture it while testing on a real account. If grok.com turns out to
  do DCR after all, skip this item and just document the URL.

### 2d. Grok Bot header alias (conditional)

If Grok Bot's custom-MCP dialog only offers an `x-api-key` style field,
extend `requirePublicApiContext` (or only the MCP route) to accept
`x-api-key: mk_live_...` as an alias for the bearer header. Log which header
was used in the API usage record. Skip if the dialog allows a custom header
name.

### 2e. DCR rate limit for shared egress IPs

`register/route.ts` uses `RATE_LIMITS.auth` (10/min per IP). ChatGPT,
grok.com, and claude.ai register from a small pool of IPs, so ten users
connecting in the same minute would fail with 429. Raise to a dedicated
`RATE_LIMITS.oauthRegister` (suggest 60/min per IP) and keep the 180-day
idle TTL as the abuse bound. Add a Sentry breadcrumb on 429 here so we see
it.

### 2f. CIMD (optional, phase 3)

`client_id_metadata_document_supported: true` and accepting an https URL as
`client_id`: fetch the document (allowlist `https://chatgpt.com/oauth/`
initially, SSRF-guarded, cached 1h), validate `redirect_uris`, treat it as a
public client. This stops ChatGPT from creating a new DCR client per
connection. Not needed for the flow to work; do it after 2a to 2e are live.

### 2g. Proxy check

No new response headers are introduced by 2a to 2f (`iss` and
`resource` are query or body parameters), so `hosting-proxy` does not need a
redeploy. Re-check this before pushing if anything in the list changes.

## Deliverable 3: distribution beyond the page

- **Skill**: rewrite "Before anything else" in `skills/markaestro/SKILL.md`
  to be client-agnostic: detect a missing `list_products`, then point the
  user at `https://markaestro.com/developers/agents?client=<their client>`.
  Keep the Claude Code `/mcp` line as one bullet among others (Cursor: Tools
  & MCP, sign in; OpenClaw: `openclaw mcp login markaestro`; Hermes:
  `/reload-mcp`; ChatGPT: reconnect the app).
- **ClawHub**: `clawhub publish skills/markaestro --slug markaestro --name
  "Markaestro" --version 0.1.0 --tags latest` (needs a GitHub account older
  than a week; run by the user, like `npm publish`). Add `openclaw skills
  install markaestro` to the OpenClaw panel once it is live.
- **Hermes**: confirm the install-from-URL syntax and document
  `hermes skills install <raw SKILL.md URL>` in the Hermes panel; submit to
  the official hub if it accepts third-party skills.
- **Cursor marketplace**: optional listing so "Add to Cursor" shows in
  Cursor's own directory.
- **Docs parity**: `public/llms.txt` (new "Connect from your client" block
  with the deep links), `mcp/README.md`, `plugin/README.md`,
  `docs/PUBLIC_API.md`, and `docs/API_CHANGELOG.md` (entries for 2a, 2b, 2e).
- **Settings, API**: a one-line "Connect an agent from Cursor, ChatGPT,
  Grok, OpenClaw, or Hermes" callout above the Connected agents list linking
  to the page. Optional.

## Testing

### Automated

- Unit: `resource` accepted / rejected on consent and token; `iss` present on
  success and error redirects; metadata advertises the new fields; first-party
  client without `expiresAt` resolves; `x-api-key` alias (if built); Cursor
  deeplink helper base64 round-trip; `redirect-uri` tests for
  `https://chatgpt.com/connector/oauth/abc` and the grok.com URI.
- `npm run ci` (lint, typecheck, copy:check, route contracts, openapi,
  docs:check, vitest) and `node scripts/check-i18n.mjs`.
- Existing `mcp/route.test.ts` and `oauth-routes.test.ts` must stay green.

### Manual matrix (production, after push; needs real accounts)

| Client | What to do | Pass when |
| --- | --- | --- |
| Cursor | Click the deeplink, open Tools & MCP, sign in | Consent page, then `list_products` returns the brand; Settings shows a Connected agent named Cursor |
| ChatGPT | Pro or Business account with Developer mode; Create app with the URL | Scan Tools succeeds after sign-in; tools listed; a chat can call `list_products` |
| grok.com | New Connector, Custom | Sign-in completes; tools appear in a chat |
| Grok Build | `grok mcp add`, `grok mcp doctor` | Browser flow, doctor reports healthy |
| xAI API | One Responses API call with the tool block | Tool call succeeds with a test key (`mk_test_`) |
| Grok Bot | Add custom MCP with a key | A Bot task lists the brand |
| OpenClaw | `mcp add`, `mcp login`, `mcp reload` | Tools in the agent's tool list |
| Hermes | config.yaml, `/reload-mcp` | `mcp_markaestro_list_products` available |
| Signed-out consent | Open the consent URL in a fresh browser | Login, then back to consent with `state`, `code_challenge`, `resource` intact |

Record results per client in `docs/operations/runbooks.md` under a new
"Connected agents" heading, including the redirect URIs each client
presented (useful when a client changes them).

## Rollout

1. **Phase 1, page and content** (no backend risk): 1a, 1b, 1c, 1d, docs
   parity, skill rewrite. Ship behind nothing; it is a marketing page.
   Cursor, Grok Build, OpenClaw, Hermes, xAI API, Claude Code, Claude become
   fully usable from this phase alone.
2. **Phase 2, protocol**: 2a, 2b, 2e first (ChatGPT). Then test grok.com on a
   real account to decide 2c, and Grok Bot to decide 2d. Push to main
   deploys; no proxy redeploy expected (2g).
3. **Phase 3**: CIMD (2f), ClawHub and Hermes hub publishing, Cursor
   marketplace, Settings callout.

## Files expected to change

- `src/app/[locale]/(marketing)/developers/agents/page.tsx`
- `src/components/marketing/AgentConnectTabs.tsx` (new)
- `src/lib/agent-connect/clients.ts` (new)
- `src/messages/*/developersAgents.json` (11 files)
- `src/lib/agent-oauth/{metadata,grants,store}.ts` and tests
- `src/app/api/oauth/agent/consent/route.ts`, `src/app/(app)/oauth/authorize/page.tsx`
- `src/app/api/public/v1/oauth/register/route.ts`, `src/lib/rate-limit.ts`
- `src/lib/public-api/auth.ts` (only if 2d)
- `scripts/seed-oauth-clients.mjs` (only if 2c)
- `src/app/(app)/settings/page.tsx` (1d, optional callout)
- `skills/markaestro/SKILL.md`, `public/llms.txt`, `mcp/README.md`, `plugin/README.md`, `docs/PUBLIC_API.md`, `docs/API_CHANGELOG.md`, `docs/operations/runbooks.md`

## Open questions for the owner

1. Is "grokbot" xAI's Grok Bot? (Assumed yes.)
2. Which accounts are available for the manual matrix: ChatGPT Pro or
   Business with Developer mode, a grok.com account, a Grok Bot seat, Cursor,
   OpenClaw and Hermes installs? Each row above needs one.
3. Should the tab strip use client wordmarks? The plan says text labels to
   avoid third-party trademark artwork on our marketing page.
4. Publish the skill to ClawHub under the `markaestro` slug now (requires the
   user's GitHub login) or wait for phase 3?

## Sources consulted

- OpenClaw: https://docs.openclaw.ai/tools/mcp, https://docs.openclaw.ai/cli/mcp, https://docs.openclaw.ai/clawhub
- Hermes Agent: https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference, https://hermes-agent.nousresearch.com/docs/guides/work-with-skills
- Cursor: https://cursor.com/docs/mcp, https://cursor.com/docs/context/mcp/install-links
- ChatGPT: https://developers.openai.com/api/docs/mcp, https://developers.openai.com/plugins/build/auth, https://zuplo.com/docs/mcp-gateway/connect-clients/chatgpt
- Grok: https://docs.x.ai/grok/connectors, https://docs.x.ai/developers/tools/remote-mcp, https://docs.x.ai/build/features/mcp-servers, https://x.ai/news/introducing-grok-bot, https://pearmcp.com/guides/grok
