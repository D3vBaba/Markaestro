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
npm run dev
```
Open http://localhost:3000

## Project structure
- `src/app/*` route pages
- `src/components/*` shared UI and layout
- `docs/MVP_PLAN.md` execution plan
- `db/schema.sql` starter database schema

## Next implementation steps
1. Pick backend (Supabase or Firebase)
2. Add auth + workspace isolation
3. Implement Campaign CRUD APIs
4. Add scheduler + channel integrations (X, TikTok, Resend)


## Firebase setup
1. Copy `.env.example` to `.env.local` and fill Firebase web keys.
2. Add server credentials via `FIREBASE_SERVICE_ACCOUNT_JSON` (or set `GOOGLE_APPLICATION_CREDENTIALS`).
3. API endpoint available: `GET/POST /api/campaigns` (Firestore collection: `campaigns`).


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
