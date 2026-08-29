import { describe, expect, it } from 'vitest';

/**
 * The deny-all rules, exercised against a real rules engine (4.13's second
 * half; the first half is the client-isolation tripwire and the access
 * matrix in docs/operations/data-access.md).
 *
 * Runs only when the Firestore emulator is up with this repo's rules loaded:
 *
 *     npx firebase emulators:start
 *     FIRESTORE_EMULATOR_HOST=localhost:8080 npm test
 *
 * Skipped otherwise, so `npm run ci` needs no emulator. Plain REST rather
 * than @firebase/rules-unit-testing: no new dependency, and the emulator
 * accepts unsigned JWTs for simulating signed-in users, which is all a
 * deny-all posture needs to prove.
 *
 * The paths probed are the sensitive representatives from the access
 * matrix: workspace-scoped user data, the root-level collections the
 * unauthenticated redirect and the limiter use, and the auth OTP store.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'markaestro-0226220726';

const PROBED_PATHS = [
  'workspaces/ws1',
  'workspaces/ws1/posts/post1',
  'workspaces/ws1/members/user1',
  'workspaces/ws1/api_clients/cli1',
  'trackedLinks/abc123',
  'conversionClicks/click1',
  'subscriptions/ws1',
  'usage/workspace:ws1',
  '_authOtps/user@example.com',
  '_rateLimits/some-key',
  '_featureFlags/intelligencePreview',
];

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * An unsigned JWT the emulator accepts as a signed-in user. This is NOT the
 * emulator's admin bypass (`Bearer owner`); it simulates exactly what a
 * browser with a real session would present, which is the case the rules
 * must deny.
 */
function fakeUserToken(uid: string): string {
  const header = base64url({ alg: 'none', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: uid,
    user_id: uid,
    auth_time: now,
    iat: now,
    exp: now + 3600,
    firebase: { sign_in_provider: 'password', identities: {} },
  });
  return `${header}.${payload}.`;
}

function docUrl(path: string): string {
  return `http://${EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
}

async function attempt(method: 'GET' | 'PATCH', path: string, auth?: string): Promise<number> {
  const response = await fetch(docUrl(path), {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(method === 'PATCH' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(method === 'PATCH'
      ? { body: JSON.stringify({ fields: { intruder: { stringValue: 'yes' } } }) }
      : {}),
  });
  // Drain so the emulator connection is reusable.
  await response.text().catch(() => undefined);
  return response.status;
}

describe.skipIf(!EMULATOR_HOST)('firestore.rules against the emulator', () => {
  it.each(PROBED_PATHS)('denies anonymous read and write on %s', async (path) => {
    expect(await attempt('GET', path)).toBe(403);
    expect(await attempt('PATCH', path)).toBe(403);
  });

  it.each(PROBED_PATHS)('denies a signed-in user read and write on %s', async (path) => {
    // The case that matters: rules that key on request.auth would pass here.
    // Deny-all must not care who you are.
    const token = fakeUserToken('user1');
    expect(await attempt('GET', path, token)).toBe(403);
    expect(await attempt('PATCH', path, token)).toBe(403);
  });

  it('denies a signed-in user even on their own membership document', async () => {
    // The most tempting future allowlist entry, pinned as denied until a
    // security review deliberately changes both the rules and this test.
    const token = fakeUserToken('user1');
    expect(await attempt('GET', 'workspaces/ws1/members/user1', token)).toBe(403);
  });
});
