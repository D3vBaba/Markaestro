# Local development

Getting from a clone to a running app used to require Firebase credentials, six
OAuth app registrations, Stripe keys, a Vertex project, and a `.env.local`
whose shape was only discoverable by reading `apphosting.yaml`. This document
is the shorter path.

## The short version

```bash
npm install
npm run env:example        # writes .env.local.example
cp .env.local.example .env.local
gcloud auth application-default login
npm run dev
```

That is enough for the composer, the calendar, the analytics views, and
everything that does not talk to a social platform.

## What you actually need

`.env.local.example` is generated from `apphosting.yaml`, so it is always
current, and it is split into two sections for exactly this reason.

**Required to boot.** The Firebase client config (already filled in, it is
public), `NEXT_PUBLIC_APP_URL`, `ENCRYPTION_KEY` (any long random string
locally, it encrypts stored OAuth tokens), and admin credentials. For
credentials, prefer `gcloud auth application-default login` over pasting a
service account JSON: it expires, it is scoped to you, and it never sits in a
file.

**Everything else is opt-in.** Each block unlocks one integration:

| To work on | Set |
| --- | --- |
| Publishing to Meta or Instagram | `META_APP_ID`, `META_APP_SECRET`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` and their redirect URIs |
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` |
| LinkedIn, Threads, Pinterest | the matching `*_CLIENT_ID` / `*_APP_ID` pair |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the `STRIPE_PRICE_*` ids |
| The AI features | `VERTEX_AI_PROJECT`, `VERTEX_AI_LOCATION` |
| Transactional email | `RESEND_API_KEY`, `RESEND_FROM` |
| The Intelligence preview | `INTELLIGENCE_PREVIEW_EMAILS` with your own address |

Leaving a block empty disables that feature rather than breaking the app. An
empty `VERTEX_AI_PROJECT` means the AI routes answer
`VERTEX_AI_NOT_CONFIGURED`; it does not mean the composer stops loading.

## Emulators

`firebase.json` carries an emulator block, so Firestore, Auth, and Storage can
run locally against no real project:

```bash
npx firebase emulators:start
```

Point the app at them with the standard Firebase environment variables
(`FIRESTORE_EMULATOR_HOST=localhost:8080`, `FIREBASE_AUTH_EMULATOR_HOST=localhost:9099`,
`FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199`) before `npm run dev`.

With the emulator up, the security-rules suite stops being skipped and runs
against the real rules engine:

```bash
FIRESTORE_EMULATOR_HOST=localhost:8080 npm test -- firestore-rules.emulator
```

It asserts deny-all holds for anonymous and signed-in users across every
sensitive path in the access matrix (`docs/operations/data-access.md`).
Allowlisting a collection someday means changing `firestore.rules`, that
suite, and the matrix together, deliberately.

One deliberate exception: `npm run validate:queries` runs against **real**
Firestore, by design. Its whole job is to prove that the composite indexes a
query needs exist in the project it will actually run in, and an emulator
creates indexes on demand, so an emulated pass would prove nothing. The
emulator is for the app, not for index validation.

## The checks

`npm run ci` runs everything CI runs. Individually:

| Command | What it protects |
| --- | --- |
| `npm run lint` | Style, plus two project rules: no `console` in server code, and no discarded `api*` result |
| `npm run typecheck` | Types |
| `npm run validate:queries` | Every Firestore query pattern has an index (real project, see above) |
| `npm run copy:check` | No em dashes, no sparkles, `n/a` for missing values |
| `npm run check:routes` | Every route authenticates, authorizes, has an error boundary, and declares a rate limit |
| `npm run check:capabilities` | The capability registry, the channel catalog, and the adapter constants agree |
| `npm run env:check` | `.env.local.example` matches `apphosting.yaml` |
| `npm run openapi:check` | The committed OpenAPI spec matches the Zod schemas |
| `npm test` | The suite |

The last five are the ones most likely to surprise you, and each fails with the
command that fixes it.

## Notes

`next dev` rewrites the top block of `AGENTS.md` on every run. Commit that
change with your work; reverting it only re-creates the diff.

Timestamped `.env.local.bak.*` files accumulate next to `.env.local`. They hold
real secrets and are covered by `.gitignore` explicitly, but they are still
plaintext credentials sitting in a working directory: delete the ones you do
not need.
