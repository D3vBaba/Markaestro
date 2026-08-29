# Rate limiting

How requests are limited, tier by tier, and how a new route gets a limiter
without anyone remembering to add one.

## The model

Deny-by-default, in two layers:

1. **New session-authenticated routes** use `defineRoute` from
   `src/lib/api-route.ts`. Omitting `rateLimit` applies `RATE_LIMITS.api`;
   opting out requires the greppable `rateLimit: null` plus a comment.
2. **The public and Connect APIs** are limited inside
   `requirePublicApiContext`: a per-client global ceiling and a per-path
   ceiling, checked together, with `X-RateLimit-*` headers on every response
   and `Retry-After` on 429s.

`scripts/check-route-contracts.mjs` (in `npm run ci`) asserts every route
declares a tier or sits in `KNOWN_UNLIMITED`, a ratchet list that may only
shrink. Fixing a route means deleting its line, and the check fails if the
line is left behind.

## Tiers (`src/lib/rate-limit.ts`)

| Tier | Ceiling | Keyed on | Protects |
| --- | --- | --- | --- |
| `api` | 100/min | uid (default) | General mutation traffic. |
| `auth` | tight | IP | OTP request/verify, session mint. |
| `ai` | 10/min | uid | The Vertex-backed intelligence routes; a rate-limited request costs no quota. |
| `strategist` | 5/min | uid | Holds a worker for the whole model call, so it is tighter than `ai`. |
| `publish` | 10/min | workspace | In-app publishing (`maxDuration 300`, outbound platform calls). Workspace-keyed so a team cannot multiply it by adding seats. |
| `publishPerAccount` | 30/hour | workspace + channel | Platform-abuse insurance; checked before the publish claim so a 429 cannot strand a post in `publishing`. |
| `mediaProxy` | 60/min | IP | The unauthenticated media proxies; the transform result is cached so repeats are redirects, not CPU. |
| `health` | 10/min | IP | The deep health probe (also behind a shared secret). |
| `ingest` | 300/min | workspace | Conversion ingest; applied after signature verification, before any write. |
| `redirect` | 60/min | IP + code | The `/r/[code]` click **recording** only; the redirect itself is never limited. |

## Two rules worth restating

- A rate-limited request must cost nothing: no AI operation, no quota unit,
  no storage reservation. Order the limiter before the charge.
- The limiter must never gate the product action of an unauthenticated
  surface (`/r/[code]` redirects, health's shallow probe); it gates the side
  effect or the expensive path.
