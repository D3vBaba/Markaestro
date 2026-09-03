/**
 * Seed the dedicated App Store tester workspace with deterministic homepage
 * screenshot fixtures. Existing user-created documents are never changed.
 *
 * The workspace receives a `fixtureFlags.marketingHomepage` marker so future
 * capture runs can identify and refresh this dataset without guessing which
 * account or records are safe to use.
 *
 * Usage:
 *   GOOGLE_CLOUD_PROJECT=markaestro-0226220726 \
 *     node scripts/seed-marketing-screenshot-account.mjs
 *
 *   # Persist the planned fixtures after reviewing the dry-run output.
 *   GOOGLE_CLOUD_PROJECT=markaestro-0226220726 \
 *     node scripts/seed-marketing-screenshot-account.mjs --apply
 */

import admin from 'firebase-admin';

const EXPECTED_EMAIL = 'appstoretester25@gmail.com';
const FIXTURE_KEY = 'marketingHomepage';
const FIXTURE_VERSION = 'homepage-v1';
const FIXTURE_ID_PREFIX = 'marketing_homepage_v1';
const APPLY = process.argv.includes('--apply');

const projectId =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    ...(projectId ? { projectId } : {}),
  });
}

const db = admin.firestore();
const auth = admin.auth();

const campaigns = [
  {
    channel: 'instagram',
    content: 'Small steps create lasting change. This week, our community helped equip another classroom with the tools to thrive.',
    hour: 9,
  },
  {
    channel: 'threads',
    content: 'Impact grows when people share what is working. What is one small win your community is celebrating this week?',
    hour: 11,
  },
  {
    channel: 'facebook',
    content: 'Meet the volunteers turning generous donations into practical support for families. Their consistency makes every milestone possible.',
    hour: 13,
  },
  {
    channel: 'linkedin',
    content: 'Purpose becomes measurable when teams pair compassion with a clear plan. Here are three lessons from our latest community partnership.',
    hour: 8,
  },
  {
    channel: 'pinterest',
    content: 'A practical guide to planning a community initiative that people can understand, support, and share.',
    hour: 15,
  },
  {
    channel: 'tiktok',
    content: 'Come behind the scenes as our team prepares the next round of community care packages.',
    hour: 17,
  },
];

function startOfCurrentUtcMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function daysInUtcMonth(monthStart) {
  return new Date(Date.UTC(
    monthStart.getUTCFullYear(),
    monthStart.getUTCMonth() + 1,
    0,
  )).getUTCDate();
}

function fixtureDates(monthStart) {
  const totalDays = daysInUtcMonth(monthStart);
  const preferredDays = [4, 5, 7, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28];
  return preferredDays.filter((day) => day <= totalDays);
}

async function resolveWorkspace(uid) {
  const memberships = await db.collectionGroup('members')
    .where('uid', '==', uid)
    .where('role', '==', 'owner')
    .limit(10)
    .get();

  if (memberships.size !== 1) {
    throw new Error(`Expected exactly one owned workspace for ${EXPECTED_EMAIL}; found ${memberships.size}.`);
  }

  const membership = memberships.docs[0];
  const workspaceRef = membership.ref.parent.parent;
  if (!workspaceRef) throw new Error('Could not resolve the workspace from the owner membership.');
  return workspaceRef;
}

async function run() {
  const user = await auth.getUserByEmail(EXPECTED_EMAIL);
  const workspaceRef = await resolveWorkspace(user.uid);
  const workspaceId = workspaceRef.id;

  const [products, assets] = await Promise.all([
    workspaceRef.collection('products').orderBy('createdAt', 'asc').limit(1).get(),
    workspaceRef.collection('media_assets').where('type', '==', 'image').limit(20).get(),
  ]);

  const product = products.docs[0];
  if (!product) throw new Error('The screenshot workspace needs at least one brand before it can be seeded.');

  const mediaUrls = assets.docs
    .map((doc) => doc.data().downloadUrl)
    .filter((url) => typeof url === 'string' && url.length > 0);
  if (mediaUrls.length === 0) {
    throw new Error('The screenshot workspace needs at least one image in its media library.');
  }

  const monthStart = startOfCurrentUtcMonth();
  const monthKey = monthStart.toISOString().slice(0, 7);
  const seededAt = new Date().toISOString();
  const dates = fixtureDates(monthStart);
  const posts = dates.map((day, index) => {
    const campaign = campaigns[index % campaigns.length];
    const scheduledAt = new Date(Date.UTC(
      monthStart.getUTCFullYear(),
      monthStart.getUTCMonth(),
      day,
      campaign.hour,
      index % 2 === 0 ? 15 : 45,
    )).toISOString();

    return {
      id: `${FIXTURE_ID_PREFIX}_${String(index + 1).padStart(2, '0')}`,
      data: {
        workspaceId,
        productId: product.id,
        createdBy: user.uid,
        content: campaign.content,
        channel: campaign.channel,
        targetChannels: [campaign.channel],
        mediaUrls: [mediaUrls[index % mediaUrls.length]],
        status: 'scheduled',
        scheduledAt,
        publishedAt: null,
        testMode: true,
        screenshotFixture: true,
        screenshotFixtureVersion: FIXTURE_VERSION,
        createdAt: seededAt,
        updatedAt: seededAt,
      },
    };
  });

  const flag = {
    enabled: true,
    version: FIXTURE_VERSION,
    accountEmail: EXPECTED_EMAIL,
    ownerUid: user.uid,
    month: monthKey,
    postIds: posts.map((post) => post.id),
    seededAt,
  };

  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    projectId: projectId || '(default)',
    email: EXPECTED_EMAIL,
    uid: user.uid,
    workspaceId,
    productId: product.id,
    productName: product.data().name,
    flagPath: `workspaces/${workspaceId}.fixtureFlags.${FIXTURE_KEY}`,
    fixtureVersion: FIXTURE_VERSION,
    month: monthKey,
    posts: posts.map(({ id, data }) => ({
      id,
      channel: data.channel,
      scheduledAt: data.scheduledAt,
      media: true,
      testMode: data.testMode,
    })),
  }, null, 2));

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to persist these fixtures.');
    return;
  }

  const batch = db.batch();
  batch.set(workspaceRef, {
    fixtureFlags: {
      [FIXTURE_KEY]: flag,
    },
    updatedAt: seededAt,
  }, { merge: true });

  for (const post of posts) {
    batch.set(workspaceRef.collection('posts').doc(post.id), post.data, { merge: true });
  }

  await batch.commit();
  console.log(`\nSeeded ${posts.length} sandbox screenshot posts and enabled ${FIXTURE_KEY}.`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
