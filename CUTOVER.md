# app.markaestro.com cutover runbook

Separates the application (`app.markaestro.com`) from the marketing site
(`markaestro.com`) on the **same** App Hosting backend via host-based routing.

## What is already done

- **Code** (branch `feat/app-subdomain-split`, committed, not yet pushed):
  - Routes split into `src/app/(marketing)` and `src/app/(app)` groups.
  - Firebase providers moved into the `(app)` layout (marketing is provider-free).
  - Host routing in `src/proxy.ts`, gated behind `APP_DOMAIN_SPLIT_ENABLED`.
  - `apphosting.yaml`: added `NEXT_PUBLIC_APP_ORIGIN`, `NEXT_PUBLIC_MARKETING_URL`,
    `APP_DOMAIN_SPLIT_ENABLED="0"`. OAuth/Stripe redirect URIs left on the apex.
  - Host-aware `robots.ts` (app subdomain disallows all crawling).
  - Verified: `tsc` clean, lint clean for changed files, no route collisions.
- **Firebase Hosting**: `app.markaestro.com` added to site `markaestro-0226220726`
  → status **Minting certificate** (auto-verified via the CNAME).
- **Firebase Auth**: `app.markaestro.com` added to Authorized domains.
- **Hostinger DNS**: removed the empty `app.markaestro.com` subdomain website;
  added `CNAME app → markaestro-0226220726.web.app` (live on the authoritative NS).

## Remaining steps (run from your machine)

The certificate is live and `app.markaestro.com` is **Connected**, so the split
flag is already set to `"1"` on the branch — this is now a single deploy.

### 1. Commit and deploy

A stale `.git/index.lock` (from a credential-less push attempt in the sandbox)
must be cleared first.

```bash
rm -f .git/index.lock
git checkout feat/app-subdomain-split
git add -A                 # picks up CUTOVER.md + the flag="1" change
git commit -m "chore: enable app.markaestro.com split"
git checkout main
git merge feat/app-subdomain-split   # or open a PR and merge
git push origin main                  # App Hosting auto-builds & rolls out
```

Wait for the rollout to show **Current** in the Firebase console
(App Hosting → markaestro → Rollouts).

### 2. Verify the cutover

- `https://markaestro.com/` → marketing loads.
- `https://markaestro.com/dashboard` → 307 redirects to `https://app.markaestro.com/dashboard`.
- `https://app.markaestro.com/` → redirects to `/dashboard` (then `/login` if signed out).
- Sign in on `app.markaestro.com`; connect a social account (OAuth callback returns
  via `markaestro.com/api/oauth/callback/...` and lands you back on the app).

## Rollback

Set `APP_DOMAIN_SPLIT_ENABLED` back to `"0"` and redeploy. All host redirects stop
immediately; the app remains reachable on both hosts. (307s are temporary and are
not cached permanently by browsers.)
