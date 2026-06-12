/**
 * Audit API keys against their creator's email-verification status.
 *
 * API key creation now requires a verified email (the public API publishes
 * content but authenticates workspace-scoped keys, not user sessions). This
 * script closes the historical window: it walks every
 * `workspaces/*\/api_clients` doc, resolves the creating user (`ownerUid`)
 * in Firebase Auth, and reports keys whose creator is currently unverified.
 *
 * Read-only by default. Revocation is a separate, explicit step:
 *
 *   # Report only (safe, no writes)
 *   node scripts/audit-api-keys.mjs
 *
 *   # Revoke flagged keys (sets status=revoked, revokedAt, revokedReason)
 *   node scripts/audit-api-keys.mjs --revoke
 *
 * Credentials: uses FIREBASE_SERVICE_ACCOUNT_JSON when set (matches
 * src/lib/firebase-admin.ts), otherwise Application Default Credentials.
 * Load .env.local first if running locally, e.g.:
 *   node --env-file=.env.local scripts/audit-api-keys.mjs
 */

import admin from 'firebase-admin';

const REVOKE = process.argv.includes('--revoke');

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.startsWith('{')) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  } else {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
}

const db = admin.firestore();
const auth = admin.auth();

/** ownerUid → { emailVerified, email, exists } (memoized — owners repeat across keys) */
const userCache = new Map();

async function lookupOwner(uid) {
  if (userCache.has(uid)) return userCache.get(uid);
  let result;
  try {
    const user = await auth.getUser(uid);
    result = { exists: true, emailVerified: user.emailVerified, email: user.email || '(no email)' };
  } catch (err) {
    if (err?.code === 'auth/user-not-found') {
      result = { exists: false, emailVerified: false, email: '(deleted user)' };
    } else {
      throw err;
    }
  }
  userCache.set(uid, result);
  return result;
}

async function main() {
  const snap = await db.collectionGroup('api_clients').get();
  console.log(`Found ${snap.size} API client(s) across all workspaces.\n`);

  const flagged = [];
  let active = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.status !== 'active') continue;
    active++;

    const workspaceId = doc.ref.parent.parent?.id ?? '(unknown)';
    const ownerUid = data.ownerUid;

    if (!ownerUid) {
      flagged.push({ doc, workspaceId, reason: 'no ownerUid recorded', owner: null });
      continue;
    }

    const owner = await lookupOwner(ownerUid);
    if (!owner.exists) {
      flagged.push({ doc, workspaceId, reason: 'creator account deleted', owner });
    } else if (!owner.emailVerified) {
      flagged.push({ doc, workspaceId, reason: 'creator email unverified', owner });
    }
  }

  console.log(`Active keys: ${active}`);
  console.log(`Flagged keys: ${flagged.length}\n`);

  for (const { doc, workspaceId, reason, owner } of flagged) {
    const data = doc.data();
    console.log(
      `  [${reason}] workspace=${workspaceId} client=${doc.id}` +
      ` name="${data.name}" keyPrefix=${data.keyPrefix}` +
      ` owner=${owner ? owner.email : data.ownerUid ?? '(none)'}` +
      ` created=${data.createdAt} lastUsed=${data.lastUsedAt ?? 'never'}`,
    );
  }

  if (flagged.length === 0) {
    console.log('Nothing to do — every active key has a verified creator.');
    return;
  }

  if (!REVOKE) {
    console.log('\nRead-only run. Re-run with --revoke to revoke the flagged keys.');
    return;
  }

  console.log('\nRevoking flagged keys…');
  const revokedAt = new Date().toISOString();
  for (const { doc, reason } of flagged) {
    await doc.ref.set(
      { status: 'revoked', revokedAt, revokedReason: `audit: ${reason}` },
      { merge: true },
    );
    console.log(`  revoked ${doc.ref.path}`);
  }
  console.log(`\nRevoked ${flagged.length} key(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
