# Markaestro

Marketing automation platform for multi-channel growth teams.

## What it is
Per-brand social publishing for Facebook, Instagram, TikTok, Threads,
Pinterest and LinkedIn, with a calendar, analytics measured from each
platform's own data, an "Intelligence" surface that explains what your own
posts did, workspaces with roles and invites, per-brand Stripe billing, and a
public API. Sign-in is passwordless (6-digit email code) or Google.

App pages live under `src/app/(app)`: dashboard, products (brands), content
(composer), calendar, analytics, intelligence, settings, guides. The marketing
site and legal pages live under `src/app/[locale]` in 10 languages.

## Run locally
```bash
npm install
npm run env:example && cp .env.local.example .env.local
gcloud auth application-default login
npm run dev
```
Open http://localhost:3000

`docs/DEVELOPMENT.md` covers what each environment variable is for, which
subset you actually need (you can work on the composer without registering any
OAuth apps), the Firebase emulators, and what every check in `npm run ci`
protects.

## Project structure
- `src/app/*` route pages
- `src/components/*` shared UI and layout
- `docs/DEVELOPMENT.md` local setup, the emulators, and what each CI check protects
- `docs/PUBLIC_API.md` the public and Connect API surfaces
- `openapi/markaestro-v1.json` the generated OpenAPI 3.1 description
- `docs/operations/*` runbooks, alerting, rate limits, worker fan-out

## Integrations & API
- `docs/PUBLIC_API.md` — the **Public API v1** (`/api/public/v1`) for publishing
  automation, plus the **Connect API** (`/api/connect/v1`): a drop-in,
  snake_case compatibility surface for pointing off-the-shelf scheduling clients
  at Markaestro. Both use workspace API keys (Settings → API).

## Firebase setup
1. `npm run env:example`, then copy `.env.local.example` to `.env.local`. It is
   generated from `apphosting.yaml`, so it lists every variable the deployment
   declares and marks which are needed just to boot.
2. Add server credentials with `gcloud auth application-default login`, or set
   `FIREBASE_SERVICE_ACCOUNT_JSON` if you need a specific service account.

See `docs/DEVELOPMENT.md` for the rest.


## Auth and workspaces
- Firebase Auth: passwordless email one-time codes (`/api/auth/otp/*`) and Google
- Server-side session cookie + ID token verification on API routes
- Workspace membership model in Firestore:
  - `workspaces/{workspaceId}`
  - `workspaces/{workspaceId}/members/{uid}`
- API authorization behavior:
  - Missing bearer token -> `401 UNAUTHENTICATED`
  - User not in workspace -> `403 FORBIDDEN_WORKSPACE`
  - First-user bootstrap creates workspace + owner membership
