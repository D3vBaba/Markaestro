/**
 * One-shot recovery for TikTok posts stuck in PROCESSING_DOWNLOAD.
 *
 *   1. Resets the named posts in Firestore (clears externalId / errorMessage /
 *      publishResults, sets status='failed') so the existing poll worker stops
 *      pinging dead publish IDs.
 *   2. Re-issues the TikTok inbox video init for each post using the same
 *      proxy URL the production adapter builds, then writes the new publish_id
 *      back to Firestore as status='publishing'. The fast-poll worker will
 *      pick it up from there.
 *
 * Usage:
 *   node scripts/restart-stuck-tiktok-posts.mjs \
 *     --workspace=default \
 *     --posts=otQsVd3Px61mwGNFfw3t,VcDqPyOzlY5JYPWHWt69
 *
 * Requires .env.local with FIREBASE_SERVICE_ACCOUNT_JSON, OAUTH_BASE_URL.
 */

import admin from 'firebase-admin';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [[m[1], m[2]]] : [];
  }),
);

if (!args.workspace || !args.posts) {
  console.error('Required: --workspace=<id> --posts=<id1,id2,...>');
  process.exit(2);
}

try {
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
} catch {
  // .env.local optional — fall through to ADC
}

function resolveAppUrl() {
  const raw = process.env.OAUTH_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://markaestro.com';
  try {
    const parsed = new URL(raw);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
      return 'https://markaestro.com';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return 'https://markaestro.com';
  }
}

const APP_URL = resolveAppUrl();
const TIKTOK_API = 'https://open.tiktokapis.com/v2';

function resolveCredential() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json && json.trim().startsWith('{')) {
    return admin.credential.cert(JSON.parse(json));
  }
  return admin.credential.applicationDefault();
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: resolveCredential() });
}
const db = admin.firestore();

function decryptAccessToken(connection) {
  const encoded = connection.accessTokenEncrypted;
  if (!encoded) return connection.accessToken || connection.access_token || '';
  const raw =
    process.env.DATA_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY ||
    process.env.WORKER_SECRET;
  if (!raw) throw new Error('DATA_ENCRYPTION_KEY / ENCRYPTION_KEY / WORKER_SECRET not set');
  const key = crypto.createHash('sha256').update(raw).digest();
  const packed = Buffer.from(encoded, 'base64');
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(packed.length - 16);
  const ciphertext = packed.subarray(12, packed.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function buildProxyUrl(mediaUrl) {
  const u = new URL('/api/media/video-proxy', APP_URL);
  u.searchParams.set('url', mediaUrl);
  return u.toString();
}

async function getConnection(workspaceId, productId) {
  const tryPaths = [];
  if (productId) tryPaths.push(`workspaces/${workspaceId}/products/${productId}/platformConnections/tiktok`);
  tryPaths.push(`workspaces/${workspaceId}/platformConnections/tiktok`);
  for (const path of tryPaths) {
    const snap = await db.doc(path).get();
    if (snap.exists) return { path, ...snap.data() };
  }
  return null;
}

async function tiktokInbox(accessToken, proxyUrl) {
  const res = await fetch(`${TIKTOK_API}/post/publish/inbox/video/init/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ source_info: { source: 'PULL_FROM_URL', video_url: proxyUrl } }),
  });
  const body = await res.json().catch(() => ({}));
  return { httpStatus: res.status, body };
}

async function processPost(workspaceId, postId) {
  const ref = db.doc(`workspaces/${workspaceId}/posts/${postId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`[${postId}] NOT FOUND`);
    return;
  }
  const post = snap.data();
  const mediaUrl = Array.isArray(post.mediaUrls) ? post.mediaUrls[0] : null;
  if (!mediaUrl) {
    console.log(`[${postId}] no mediaUrl`);
    return;
  }

  console.log(`[${postId}] resetting from status=${post.status} externalId=${post.externalId}`);
  const now = new Date().toISOString();
  await ref.update({
    status: 'failed',
    externalId: '',
    externalUrl: '',
    publishResults: [],
    errorMessage: 'Stopped for fix verification — restarting',
    updatedAt: now,
  });

  const conn = await getConnection(workspaceId, post.productId);
  if (!conn) {
    console.log(`[${postId}] no TikTok connection — leaving in failed state`);
    return;
  }
  const accessToken = decryptAccessToken(conn);
  if (!accessToken) {
    console.log(`[${postId}] could not decrypt accessToken — leaving in failed state`);
    return;
  }

  const proxyUrl = buildProxyUrl(mediaUrl);
  console.log(`[${postId}] init via ${proxyUrl}`);

  const result = await tiktokInbox(accessToken, proxyUrl);
  console.log(`[${postId}] tiktok http=${result.httpStatus} body=${JSON.stringify(result.body)}`);

  const publishId = result.body?.data?.publish_id;
  const errCode = result.body?.error?.code;
  if (publishId && (!errCode || errCode === 'ok')) {
    await ref.update({
      status: 'publishing',
      externalId: publishId,
      errorMessage: '',
      publishResults: [{ channel: 'tiktok', success: false, pending: true, externalId: publishId }],
      updatedAt: new Date().toISOString(),
    });
    console.log(`[${postId}] OK — new publish_id=${publishId}`);
  } else {
    await ref.update({
      status: 'failed',
      errorMessage: `Re-init failed: ${result.body?.error?.message || 'unknown'} (${errCode || result.httpStatus})`,
      updatedAt: new Date().toISOString(),
    });
    console.log(`[${postId}] FAILED to re-init`);
  }
}

(async () => {
  const postIds = args.posts.split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of postIds) {
    await processPost(args.workspace, id);
  }
  process.exit(0);
})().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
