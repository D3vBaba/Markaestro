/**
 * Diagnose the most recent TikTok post pushed from Markaestro.
 *
 *   1. Finds the newest post with channel=tiktok across all workspaces.
 *   2. Prints its Firestore status, externalId (publish_id), and stored error.
 *   3. Fetches the live status from TikTok's
 *      /v2/post/publish/status/fetch/ endpoint using the connection's
 *      access token.
 *
 * Usage:
 *   node scripts/check-last-tiktok-post.mjs
 *   node scripts/check-last-tiktok-post.mjs --workspace=<id>
 *   node scripts/check-last-tiktok-post.mjs --post=<postId> --workspace=<id>
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS to point at a service account with
 * Firestore read access (same creds as the other scripts in this folder).
 */

import admin from 'firebase-admin';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [[m[1], m[2]]] : [];
  }),
);

// Load .env.local so FIREBASE_SERVICE_ACCOUNT_JSON is available without
// requiring `dotenv` in package deps.
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

function resolveCredential() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    const parsed = JSON.parse(json);
    return admin.credential.cert(parsed);
  }
  return admin.credential.applicationDefault();
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: resolveCredential() });
}
const db = admin.firestore();

async function findLatestTikTokPost(workspaceFilter) {
  const workspaces = workspaceFilter
    ? [{ id: workspaceFilter }]
    : (await db.collection('workspaces').get()).docs;

  let latest = null;
  for (const ws of workspaces) {
    const wsId = ws.id;
    const snap = await db
      .collection(`workspaces/${wsId}/posts`)
      .where('channel', '==', 'tiktok')
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();
    if (snap.empty) continue;
    const doc = snap.docs[0];
    const data = doc.data();
    if (!latest || (data.updatedAt || '') > (latest.updatedAt || '')) {
      latest = { workspaceId: wsId, postId: doc.id, ...data };
    }
  }
  return latest;
}

async function getPostById(workspaceId, postId) {
  const snap = await db.doc(`workspaces/${workspaceId}/posts/${postId}`).get();
  if (!snap.exists) return null;
  return { workspaceId, postId, ...snap.data() };
}

async function getTikTokConnection(workspaceId, productId) {
  // Mirror lib/platform/connections.ts lookup: product-scoped first, then workspace-scoped.
  const tryPaths = [];
  if (productId) {
    tryPaths.push(`workspaces/${workspaceId}/products/${productId}/connections/tiktok`);
  }
  tryPaths.push(`workspaces/${workspaceId}/connections/tiktok`);

  for (const path of tryPaths) {
    const snap = await db.doc(path).get();
    if (snap.exists) return { path, ...snap.data() };
  }
  return null;
}

async function fetchTikTokStatus(accessToken, publishId) {
  const res = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const body = await res.json().catch(() => ({}));
  return { httpStatus: res.status, body };
}

function redact(token) {
  if (!token || typeof token !== 'string') return '<missing>';
  return `${token.slice(0, 6)}…${token.slice(-4)} (len=${token.length})`;
}

(async () => {
  const post = args.post
    ? await getPostById(args.workspace, args.post)
    : await findLatestTikTokPost(args.workspace);

  if (!post) {
    console.log('No TikTok post found.');
    process.exit(1);
  }

  console.log('=== Firestore post ===');
  console.log({
    workspaceId: post.workspaceId,
    postId: post.postId,
    status: post.status,
    nextAction: post.nextAction,
    channel: post.channel,
    externalId: post.externalId,
    externalUrl: post.externalUrl,
    publishedAt: post.publishedAt,
    exportedForReviewAt: post.exportedForReviewAt,
    updatedAt: post.updatedAt,
    errorMessage: post.errorMessage,
    publishResults: post.publishResults,
    productId: post.productId,
    createdByType: post.createdByType,
    createdById: post.createdById,
  });

  if (!post.externalId) {
    console.log('\nNo externalId (publish_id) stored — the init call likely failed before TikTok returned one.');
    console.log('Check errorMessage / publishResults above for the init-time error.');
    return;
  }

  const connection = await getTikTokConnection(post.workspaceId, post.productId);
  if (!connection) {
    console.log('\nNo TikTok connection found for this workspace/product. Cannot query status.');
    return;
  }

  const accessToken = connection.accessToken || connection.access_token;
  console.log('\n=== Connection ===');
  console.log({
    path: connection.path,
    openId: connection.openId || connection.open_id,
    username: connection.username,
    scope: connection.scope,
    expiresAt: connection.expiresAt,
    accessTokenPreview: redact(accessToken),
  });

  if (!accessToken) {
    console.log('\nNo access token on connection doc — cannot query TikTok.');
    return;
  }

  console.log('\n=== TikTok live status ===');
  const status = await fetchTikTokStatus(accessToken, String(post.externalId));
  console.log(JSON.stringify(status, null, 2));

  const tkStatus = status.body?.data?.status;
  const failReason = status.body?.data?.fail_reason;

  console.log('\n=== Interpretation ===');
  if (status.body?.error?.code && status.body.error.code !== 'ok') {
    console.log(`TikTok API error: ${status.body.error.code} — ${status.body.error.message}`);
    console.log(`log_id=${status.body.error.log_id} (share with TikTok support if needed)`);
  } else if (tkStatus === 'PROCESSING_UPLOAD' || tkStatus === 'PROCESSING_DOWNLOAD') {
    console.log('Still processing on TikTok side. Wait a minute and re-run.');
  } else if (tkStatus === 'SEND_TO_USER_INBOX') {
    console.log('Delivered to the TikTok app inbox. Open TikTok → Inbox tab → look for the upload notification.');
    console.log('Drafts expire after ~7 days if not finalized.');
  } else if (tkStatus === 'PUBLISH_COMPLETE') {
    console.log('TikTok says the post is live.');
  } else if (tkStatus === 'FAILED') {
    console.log(`TikTok rejected the post: ${failReason || 'no reason given'}`);
  } else {
    console.log(`Unknown status: ${tkStatus}`);
  }

  process.exit(0);
})().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
