#!/usr/bin/env node
/**
 * Seed a first-party OAuth client for the agent sign-in flow.
 *
 * Why this exists. MCP clients normally register themselves (RFC 7591) and
 * no one has to configure anything. Some connector dialogs instead ask the
 * user for a client id (grok.com's custom connector does), so Markaestro has
 * to hold a pre-registered public client whose id is printed on
 * /developers/agents. This script writes that record.
 *
 * What it writes, at `oauth_clients/<client-id>`:
 *   - a public client (`token_endpoint_auth_method: none`, PKCE only)
 *   - the redirect URIs the connector presents, exact match (https or a
 *     custom scheme; plain http is refused)
 *   - `firstParty: true` and NO `expiresAt`, so the Firestore TTL policy on
 *     the collection never deletes it and token exchanges never write an
 *     expiry onto it (see src/lib/agent-oauth/store.ts)
 *
 * Idempotent: re-running with the same id merges the redirect URIs and keeps
 * `createdAt` and `lastUsedAt`. Dry-run by default; nothing is written
 * without --apply.
 *
 * Usage:
 *
 *   node --env-file=.env.local scripts/seed-oauth-clients.mjs \
 *     --client-id markaestro-grok-web \
 *     --name Grok \
 *     --client-uri https://grok.com \
 *     --redirect-uri https://grok.com/oauth/callback \
 *     [--redirect-uri https://...]   # repeatable
 *     [--apply]
 *
 * The client id must match the FIRST_PARTY_OAUTH_CLIENT_IDS entry in
 * src/lib/agent-connect/clients.ts, which is what the page shows users.
 * Capture the exact redirect URI from the connector's dialog or vendor docs
 * while testing on a real account; a wrong one fails at consent with
 * OAUTH_REDIRECT_URI_MISMATCH, never with a token being issued.
 */

import admin from 'firebase-admin';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
function readOptions(name) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) if (args[i] === name && args[i + 1]) out.push(args[i + 1]);
  return out;
}

const clientId = readOption('--client-id');
const clientName = readOption('--name');
const clientUri = readOption('--client-uri') ?? null;
const redirectUris = readOptions('--redirect-uri');

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

if (!clientId || !/^markaestro-[a-z0-9-]{2,40}$/.test(clientId)) {
  fail('--client-id is required and must look like markaestro-<slug> (lowercase letters, digits, hyphens).');
}
if (!clientName || clientName.trim().length === 0 || clientName.length > 200) fail('--name is required (at most 200 characters).');
if (redirectUris.length === 0) fail('at least one --redirect-uri is required.');
if (clientUri !== null) {
  try {
    if (new URL(clientUri).protocol !== 'https:') throw new Error();
  } catch {
    fail('--client-uri must be an https URL.');
  }
}

// Same policy as src/lib/agent-oauth/redirect-uri.ts, minus loopback: a
// first-party client stands in for a hosted vendor, which never redirects to
// localhost. Plain http to a real host would send the code in the clear.
function isAllowedRedirectUri(candidate) {
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.hash || candidate.length > 2048) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return false;
  return !/^(javascript|data|file|blob|about):$/i.test(url.protocol);
}
for (const uri of redirectUris) if (!isAllowedRedirectUri(uri)) fail(`redirect URI not allowed: ${uri}`);

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!projectId) fail('set GOOGLE_CLOUD_PROJECT or NEXT_PUBLIC_FIREBASE_PROJECT_ID (run with node --env-file=.env.local).');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
const db = admin.firestore();

const ref = db.collection('oauth_clients').doc(clientId);
const existing = await ref.get();
const now = new Date().toISOString();
const current = existing.exists ? existing.data() : null;

const record = {
  clientName: clientName.trim(),
  redirectUris: Array.from(new Set([...(current?.redirectUris ?? []), ...redirectUris])),
  grantTypes: ['authorization_code', 'refresh_token'],
  responseTypes: ['code'],
  tokenEndpointAuthMethod: 'none',
  secretHash: null,
  clientUri,
  createdAt: current?.createdAt ?? now,
  lastUsedAt: current?.lastUsedAt ?? null,
  firstParty: true,
  // Belt and braces: a record that somehow gained an expiry (for example a
  // manual edit) is put back outside the TTL policy.
  expiresAt: admin.firestore.FieldValue.delete(),
};

console.log(`${APPLY ? 'Writing' : 'Would write'} oauth_clients/${clientId} in project ${projectId}:`);
console.log(JSON.stringify({ ...record, expiresAt: '(deleted)' }, null, 2));
if (existing.exists) console.log(`(document exists; created ${current.createdAt}, last used ${current.lastUsedAt ?? 'never'})`);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.');
  process.exit(0);
}
await ref.set(record, { merge: true });
console.log('Done. The client id is public; users paste it into the connector dialog together with a blank secret.');
