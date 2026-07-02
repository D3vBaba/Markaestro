/**
 * Read-only diagnostics for Meta-family connections (meta / instagram / threads).
 * Decrypts stored tokens and probes the Graph APIs with GETs only.
 */
import admin from 'firebase-admin';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env.local
const envPath = resolve(process.cwd(), '.env.local');
const raw = readFileSync(envPath, 'utf8');
for (const line of raw.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  if (!process.env[m[1]]) {
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
}

function resolveCredential() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json && json.trim().startsWith('{')) {
    return admin.credential.cert(JSON.parse(json));
  }
  return admin.credential.applicationDefault();
}

admin.initializeApp({
  credential: resolveCredential(),
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'markaestro-0226220726',
});
const db = admin.firestore();

const KEY = crypto.createHash('sha256')
  .update(process.env.DATA_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || process.env.WORKER_SECRET || '')
  .digest();

function decrypt(encoded) {
  const packed = Buffer.from(encoded, 'base64');
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(packed.length - 16);
  const ciphertext = packed.subarray(12, packed.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

async function probe(label, url, init) {
  try {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => ({}));
    console.log(`  [${res.status}] ${label}`);
    console.log(`        ${JSON.stringify(body).slice(0, 400)}`);
    return { status: res.status, body };
  } catch (e) {
    console.log(`  [ERR] ${label}: ${e.message}`);
    return { status: 0, body: {} };
  }
}

const q = (params) => new URLSearchParams(params).toString();

const snap = await db.collectionGroup('platformConnections').get();
const interesting = snap.docs.filter((d) =>
  ['meta', 'instagram', 'threads'].includes(d.data().provider));

console.log(`Found ${snap.size} connections total, ${interesting.length} Meta-family:\n`);

for (const doc of interesting) {
  const c = doc.data();
  const md = c.metadata || {};
  console.log(`━━━ ${doc.ref.path}`);
  console.log(`  provider=${c.provider} status=${c.status} tokenExpiresAt=${c.tokenExpiresAt || '-'} updatedAt=${c.updatedAt || '-'}`);
  console.log(`  metadata: ${JSON.stringify({
    igAccountId: md.igAccountId, username: md.username, loginType: md.loginType,
    instagramPermissions: md.instagramPermissions,
    pageId: md.pageId, pageName: md.pageName,
    hasPageToken: Boolean(md.pageAccessTokenEncrypted),
    pageSelectionRequired: md.pageSelectionRequired,
    threadsUserId: md.threadsUserId,
    lastRefreshError: md.lastRefreshError, refreshFailureCount: md.refreshFailureCount,
  })}`);

  let token;
  try {
    token = decrypt(c.accessTokenEncrypted);
  } catch (e) {
    console.log(`  !! cannot decrypt access token: ${e.message}`);
    continue;
  }

  if (c.provider === 'instagram') {
    const ig = md.igAccountId;
    await probe('GET graph.instagram.com/v25.0/me?fields=id,user_id,username,account_type',
      `https://graph.instagram.com/v25.0/me?${q({ fields: 'id,user_id,username,account_type', access_token: token })}`);
    await probe('GET graph.instagram.com/me (unversioned)',
      `https://graph.instagram.com/me?${q({ fields: 'id,user_id,username,account_type', access_token: token })}`);
    await probe('GET graph.instagram.com/v23.0/me',
      `https://graph.instagram.com/v23.0/me?${q({ fields: 'id,user_id,username,account_type', access_token: token })}`);
    if (ig) {
      await probe(`GET graph.instagram.com/v25.0/${ig}?fields=id,username`,
        `https://graph.instagram.com/v25.0/${ig}?${q({ fields: 'id,username', access_token: token })}`);
      await probe(`GET graph.instagram.com/v25.0/${ig}/content_publishing_limit`,
        `https://graph.instagram.com/v25.0/${ig}/content_publishing_limit?${q({ fields: 'quota_usage', access_token: token })}`);
    }
  }

  if (c.provider === 'meta') {
    await probe('GET graph.facebook.com/v22.0/me (user token)',
      `https://graph.facebook.com/v22.0/me?${q({ fields: 'id,name', access_token: token })}`);
    const appId = process.env.META_APP_ID, appSecret = process.env.META_APP_SECRET;
    if (appId && appSecret) {
      const dbg = await probe('GET debug_token (user token)',
        `https://graph.facebook.com/v22.0/debug_token?${q({ input_token: token, access_token: `${appId}|${appSecret}` })}`);
      const d = dbg.body?.data;
      if (d) console.log(`        scopes=${(d.scopes || []).join(',')} expires_at=${d.expires_at} valid=${d.is_valid}`);
    }
    if (md.pageAccessTokenEncrypted && md.pageId) {
      try {
        const pageToken = decrypt(md.pageAccessTokenEncrypted);
        await probe(`GET page ${md.pageId}?fields=name,instagram_business_account (page token)`,
          `https://graph.facebook.com/v22.0/${md.pageId}?${q({ fields: 'name,instagram_business_account{id,username}', access_token: pageToken })}`);
      } catch (e) {
        console.log(`  !! cannot decrypt page token: ${e.message}`);
      }
    }
  }

  if (c.provider === 'threads') {
    await probe('GET graph.threads.net/v1.0/me',
      `https://graph.threads.net/v1.0/me?${q({ fields: 'id,username', access_token: token })}`);
  }
  console.log('');
}
// ── Deep probes (v2) ─────────────────────────────────────────────────
console.log('━━━ App liveness (app access tokens)');
const apps = [
  ['META', process.env.META_APP_ID, process.env.META_APP_SECRET],
  ['INSTAGRAM', process.env.INSTAGRAM_APP_ID, process.env.INSTAGRAM_APP_SECRET],
  ['THREADS', process.env.THREADS_APP_ID, process.env.THREADS_APP_SECRET],
];
for (const [name, id, secret] of apps) {
  if (!id || !secret) { console.log(`  ${name}: missing env`); continue; }
  await probe(`GET graph.facebook.com/v22.0/${id} (app ${name})`,
    `https://graph.facebook.com/v22.0/${id}?${q({ fields: 'name,link', access_token: `${id}|${secret}` })}`);
}

console.log('\n━━━ Fresh Instagram token deep-dive');
const freshDoc = interesting.find((d) => d.ref.path.includes('pvI16GwWioEdUS4T7BIp'));
if (freshDoc) {
  const c = freshDoc.data();
  const token = decrypt(c.accessTokenEncrypted);
  console.log(`  token prefix: ${token.slice(0, 6)}... length=${token.length}`);
  for (const [name, id, secret] of apps.slice(0, 2)) {
    const r = await probe(`debug_token via ${name} app token`,
      `https://graph.facebook.com/v22.0/debug_token?${q({ input_token: token, access_token: `${id}|${secret}` })}`);
    const d = r.body?.data;
    if (d) console.log(`        app_id=${d.app_id} type=${d.type} valid=${d.is_valid} scopes=${(d.scopes||[]).join(',')} granular=${JSON.stringify(d.granular_scopes||[]).slice(0,200)}`);
  }
  await probe('refresh_access_token (ig_refresh_token)',
    `https://graph.instagram.com/refresh_access_token?${q({ grant_type: 'ig_refresh_token', access_token: token })}`);
}

console.log('\n━━━ EyeCash meta page-token probe');
const eyecashDoc = interesting.find((d) => d.ref.path.includes('N7eAHML2tUG2y7ZAfDod'));
if (eyecashDoc) {
  const md = eyecashDoc.data().metadata || {};
  if (md.pageAccessTokenEncrypted) {
    const pageToken = decrypt(md.pageAccessTokenEncrypted);
    console.log(`  page token prefix: ${pageToken.slice(0, 6)}... length=${pageToken.length}`);
    await probe(`GET page ${md.pageId}?fields=name,instagram_business_account`,
      `https://graph.facebook.com/v22.0/${md.pageId}?${q({ fields: 'name,instagram_business_account{id,username}', access_token: pageToken })}`);
    await probe('debug_token page token via META app',
      `https://graph.facebook.com/v22.0/debug_token?${q({ input_token: pageToken, access_token: `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}` })}`);
  }
}
process.exit(0);
