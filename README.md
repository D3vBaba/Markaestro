# Markaestro

Marketing automation platform for multi-channel growth teams.

## Current status
This repository now includes a functional front-end scaffold for:
- Dashboard
- Contacts
- Campaigns
- Automations
- Analytics
- Settings

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
- `docs/MVP_PLAN.md` execution plan

## Integrations & API
- `docs/PUBLIC_API.md` — the **Public API v1** (`/api/public/v1`) for publishing
  automation, plus the **Connect API** (`/api/connect/v1`): a drop-in,
  snake_case compatibility surface for pointing off-the-shelf scheduling clients
  at Markaestro. Both use workspace API keys (Settings → API).

## Next implementation steps
1. Pick backend (Supabase or Firebase)
2. Add auth + workspace isolation
3. Implement Campaign CRUD APIs
4. Add scheduler + channel integrations (X, TikTok, Resend)


## Firebase setup
1. `npm run env:example`, then copy `.env.local.example` to `.env.local`. It is
   generated from `apphosting.yaml`, so it lists every variable the deployment
   declares and marks which are needed just to boot.
2. Add server credentials with `gcloud auth application-default login`, or set
   `FIREBASE_SERVICE_ACCOUNT_JSON` if you need a specific service account.

See `docs/DEVELOPMENT.md` for the rest.


## Backend Phase 1 (implemented)
- Firebase Auth integrated (email/password + Google UI)
- Server-side ID token verification on API routes
- Workspace membership model in Firestore:
  - `workspaces/{workspaceId}`
  - `workspaces/{workspaceId}/members/{uid}`
- API authorization behavior:
  - Missing bearer token -> `401 UNAUTHENTICATED`
  - User not in workspace -> `403 FORBIDDEN_WORKSPACE`
  - First-user bootstrap creates workspace + owner membership
