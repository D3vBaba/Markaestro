# Auth flow audit (Firebase + Resend)

This app uses Firebase Auth on the client, `firebase-admin` on the server, and a signed `__session` cookie for page access. Auth emails are delivered via **Resend** using Firebase-generated action links that deep-link to `/auth/action`.

## Required env vars

- `RESEND_API_KEY`: Resend API key
- `RESEND_FROM` (optional): e.g. `Markaestro <no-reply@markaestro.com>`
- `NEXT_PUBLIC_APP_URL`: base URL used to generate action links (e.g. `https://markaestro.com`)

## Auth email endpoints (server)

- `POST /api/auth/emails/password-reset` (public)
  - body: `{ "email": "user@domain.com" }`
  - behavior: always returns `{ ok: true }` (non-enumerating)
- `POST /api/auth/emails/verify-email` (requires `Authorization: Bearer <idToken>`)
- `POST /api/auth/emails/email-change` (requires `Authorization: Bearer <idToken>`)
  - body: `{ "newEmail": "new@domain.com" }`
- `POST /api/auth/logout-all` (requires `Authorization: Bearer <idToken>`)
  - revokes Firebase refresh tokens and clears `__session`

## Action handler (client)

- `GET /auth/action?...` (public)
  - handles `mode=resetPassword|verifyEmail|verifyAndChangeEmail`
  - uses Firebase client SDK to apply/confirm action codes

## End-to-end verification checklist

### 1) Sign up → verification email (Resend) → verify in-app

- Create a new account via `/login` (Sign Up).
- Expected:
  - A verification email is delivered via Resend.
  - Clicking the button lands on `/auth/action?mode=verifyEmail...`.
  - The page shows success.
- Optional:
  - Go to `/settings` → **Security** → **Email verification**.
  - Click “Send verification email” to confirm resend works and is rate-limited.

### 2) Password reset/change email (Resend) → set new password in-app

- From `/login`, use “Forgot password?” → “Send Reset Link”.
- Or from `/settings` → **Security** → **Password** → “Reset password”.
- Expected:
  - Email is delivered via Resend.
  - Clicking the button lands on `/auth/action?mode=resetPassword...`.
  - Setting a new password succeeds and user can sign in with it.

### 3) Email change (Resend) → confirm in-app

- From `/settings` → **Security** → **Change email**:
  - enter a new email and click “Send confirmation”.
- Expected:
  - New email receives a confirmation email (Resend).
  - Old email receives a “requested” notice (Resend).
  - Clicking the new-email confirmation lands on `/auth/action?mode=verifyAndChangeEmail...` and succeeds.
  - Signing in thereafter uses the new email.

### 4) Logout all devices

- From `/settings` → **Security** → “Sign out”.
- Expected:
  - Session cookie is cleared.
  - Refresh tokens are revoked (other devices should be forced to re-authenticate on next token refresh).

## Notes

- The password-reset endpoint is intentionally non-enumerating (it returns success even if the account doesn’t exist).
- All auth email endpoints are rate-limited via Firestore-backed limiter (`RATE_LIMITS.auth`).

## Post-trial email verification gate

After onboarding is complete (user has at least one product) **and** Stripe reports an **active or trialing** subscription, users with **unverified** email/password accounts see a full-screen **Verify your email** screen instead of the app. API routes that use `requireContext` return `403` with `EMAIL_VERIFICATION_REQUIRED` in the same situation. Exempt routes include `/api/stripe/status` and `/api/auth/*` so the client can load subscription state and resend verification.

