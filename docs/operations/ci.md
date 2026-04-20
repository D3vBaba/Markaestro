# Continuous Integration

CI is expected to gate every merge on:

1. ESLint (`npm run lint`)
2. TypeScript (`npx tsc --noEmit`)
3. Unit tests (`npm test`)
4. Firestore query validation (`npm run validate:queries`)
5. `next build`
6. Secret scan (gitleaks)

GitHub Actions workflow was not committed automatically because the
repository pre-edit hook blocks workflow writes for security review.
Create `.github/workflows/ci.yml` manually with the following contents:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    name: Lint + Test + Typecheck + Build
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      # Placeholders only. These MUST NOT match any real deployment.
      NEXT_PUBLIC_FIREBASE_API_KEY: ci-placeholder
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: ci-placeholder
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: ci-placeholder.firebaseapp.com
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: ci-placeholder.appspot.com
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '0'
      NEXT_PUBLIC_FIREBASE_APP_ID: '1:0:web:ci'
      NEXT_PUBLIC_APP_URL: http://localhost:3000
      DATA_ENCRYPTION_KEY: ci-placeholder-encryption-key-please-ignore
      SESSION_SIGNING_KEY: ci-placeholder-session-key-please-ignore
      NEXT_TELEMETRY_DISABLED: '1'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: maerkestro/package-lock.json
      - working-directory: maerkestro
        run: npm ci
      - working-directory: maerkestro
        run: npm run lint
      - working-directory: maerkestro
        run: npx tsc --noEmit
      - working-directory: maerkestro
        run: npm run validate:queries
      - working-directory: maerkestro
        run: npm test
      - working-directory: maerkestro
        run: npm run build

  secret-scan:
    name: Secret scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Branch protection

In GitHub → Settings → Branches → main, require:

- `verify` and `secret-scan` checks pass
- PR reviews from at least 1 reviewer
- Branches to be up to date before merge
- Signed commits (optional but recommended)
