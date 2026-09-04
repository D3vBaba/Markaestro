/**
 * Seed a dedicated DEMO workspace for marketing screenshots, owned by the
 * App Store tester account. Everything lives in its own workspace document
 * tree (`workspaces/ws-5eed0000c0ffee0000000001`), its own subscription
 * record and its own Storage prefix, so the tester's real workspace and
 * every other account are never read for writing, let alone changed.
 *
 * The workspace carries `fixtureFlags.marketingDemo`; `--reset` refuses to
 * delete anything that does not carry that marker.
 *
 * What it writes (all deterministic ids, safe to re-run):
 *   - workspace, owner membership, comped Business subscription
 *   - one brand ("Northwind Roasters") with voice, identity and a logo
 *   - seven fixture platform connections (status connected, `fixture: true`,
 *     no credentials; workers skip them, see PlatformConnection.fixture)
 *   - media assets (generated images uploaded to Storage)
 *   - published posts with metrics + per-post metric snapshots
 *   - canonical socialPosts (with fingerprints) for Intelligence
 *   - scheduled posts and drafts for the calendar and composer
 *   - analyticsDaily / analyticsActivity rollups and audienceSnapshots
 *   - an Intelligence audience profile for the brand
 *
 * Usage:
 *   GOOGLE_CLOUD_PROJECT=markaestro-0226220726 \
 *     DEMO_MEDIA_DIR=/path/to/images node scripts/seed-marketing-demo-workspace.mjs           # dry run
 *   ... node scripts/seed-marketing-demo-workspace.mjs --apply                                  # write
 *   ... node scripts/seed-marketing-demo-workspace.mjs --reset                                  # delete the demo workspace
 */

import admin from 'firebase-admin';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

const EXPECTED_EMAIL = 'appstoretester25@gmail.com';
const DEMO_WS_ID = 'ws-5eed0000c0ffee0000000001';
const PRODUCT_ID = 'demo_northwind_roasters';
const FIXTURE_KEY = 'marketingDemo';
const FIXTURE_VERSION = 'demo-v1';
const APPLY = process.argv.includes('--apply');
const RESET = process.argv.includes('--reset');
const MEDIA_DIR = process.env.DEMO_MEDIA_DIR;
const TZ_OFFSET_HOURS = -7; // America/Los_Angeles in September

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId, storageBucket: BUCKET });
}
const db = admin.firestore();
const auth = admin.auth();

// ── deterministic randomness ────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260904);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);
const round = (n) => Math.round(n);

// ── brand ───────────────────────────────────────────────────────────────────
const BRAND = {
  name: 'Northwind Roasters',
  description: 'Small-batch specialty coffee roaster in Portland. Single origins, seasonal blends, and brew guides for people who want better coffee at home.',
  url: 'https://northwindroasters.example',
  categories: ['food-restaurant', 'ecommerce'],
  brandVoice: {
    tone: 'Warm, plainspoken, quietly nerdy about coffee',
    style: 'Short sentences. Specifics over superlatives. One idea per post.',
    keywords: ['single origin', 'small batch', 'brew guide', 'roast date', 'pour-over', 'seasonal blend'],
    avoidWords: ['artisanal', 'elevate', 'game-changer', 'journey'],
    cta: 'Order this week\'s roast at northwindroasters.example',
    sampleVoice: 'We roasted this Huila lot a little lighter than last year. More stone fruit, less caramel. Brew it at 94°C and let it cool for a minute before you judge it.',
    targetAudience: 'Home brewers aged 25 to 44 in the US and Canada who already own a grinder and want to get more out of it.',
  },
  brandIdentity: { primaryColor: '#3B2A20', secondaryColor: '#C8A27A', accentColor: '#E07A3F' },
};

const CHANNEL_ACCOUNTS = {
  instagram: { provider: 'instagram', accountKey: 'fx_ig_northwind', metadata: { username: 'northwindroasters', displayName: 'Northwind Roasters', accountId: 'fx_ig_northwind', igAccountId: 'fx_ig_northwind' } },
  facebook: { provider: 'meta', accountKey: 'fx_page_northwind', metadata: { pageId: 'fx_page_northwind', pageName: 'Northwind Roasters', displayName: 'Northwind Roasters' } },
  tiktok: { provider: 'tiktok', accountKey: 'fx_tt_northwind', metadata: { username: 'northwind.roasters', displayName: 'Northwind Roasters', openId: 'fx_tt_northwind' } },
  threads: { provider: 'threads', accountKey: 'fx_th_northwind', metadata: { username: 'northwindroasters', displayName: 'Northwind Roasters', userId: 'fx_th_northwind', threadsUserId: 'fx_th_northwind' } },
  linkedin: { provider: 'linkedin', accountKey: 'fx_li_northwind', metadata: { linkedinDestinationName: 'Northwind Roasters', linkedinDestinationUrn: 'urn:li:organization:fx_li_northwind', linkedinDestinationAccountId: 'fx_li_northwind', linkedinDestinationType: 'page', linkedinPages: [{ id: 'fx_li_northwind', urn: 'urn:li:organization:fx_li_northwind', name: 'Northwind Roasters', role: 'ADMINISTRATOR' }], linkedinScopes: ['w_organization_social', 'r_organization_social', 'w_member_social', 'openid', 'profile'], displayName: 'Northwind Roasters', organizationId: 'fx_li_northwind' } },
  pinterest: { provider: 'pinterest', accountKey: 'fx_pi_northwind', metadata: { username: 'northwindroasters', boardId: 'fx_board_brew_guides', boardName: 'Brew Guides', displayName: 'Northwind Roasters' } },
  x: { provider: 'x', accountKey: 'fx_x_northwind', metadata: { username: 'northwindroast', displayName: 'Northwind Roasters', userId: 'fx_x_northwind' } },
};

// ── showcase brands ─────────────────────────────────────────────────────────
// Extra brands so the Brands grid reads like an agency roster. Products and
// fixture connections only: no posts, media or metrics, so every other page
// stays about Northwind Roasters.
const SHOWCASE_BRANDS = [
  { id: 'demo_fern_fog_bakery', slug: 'fernfog', name: 'Fern & Fog Bakery', categories: ['food-restaurant', 'local-business'], url: 'https://fernandfog.example', daysAgo: 2,
    description: 'Neighbourhood bakery in Portland. Sourdough, laminated pastry and a Saturday queue that starts before we open.', channels: ['instagram', 'facebook', 'tiktok'] },
  { id: 'demo_tidewater_kayak', slug: 'tidewater', name: 'Tidewater Kayak Co.', categories: ['travel-hospitality', 'ecommerce'], url: 'https://tidewaterkayak.example', daysAgo: 6,
    description: 'Guided sea kayak tours and rentals on the Oregon coast, April to October. Small groups, warm gear included.', channels: ['instagram', 'facebook', 'pinterest'] },
  { id: 'demo_lumen_skincare', slug: 'lumen', name: 'Lumen Skincare', categories: ['fashion-beauty', 'ecommerce'], url: 'https://lumenskin.example', daysAgo: 11,
    description: 'Fragrance-free skincare in refillable glass. Five products, and no routine longer than two minutes.', channels: ['instagram', 'tiktok', 'threads'] },
  { id: 'demo_brightline_books', slug: 'brightline', name: 'Brightline Bookkeeping', categories: ['coaching-services', 'local-business'], url: 'https://brightlinebooks.example', daysAgo: 19,
    description: 'Monthly bookkeeping and tax prep for cafes, salons and studios with under twenty staff.', channels: ['linkedin', 'facebook', 'x'] },
  { id: 'demo_hollow_pine_studio', slug: 'hollowpine', name: 'Hollow Pine Studio', categories: ['creator', 'personal-brand'], url: 'https://hollowpine.example', daysAgo: 27,
    description: 'Furniture maker sharing the build, from log to finished table, one short video at a time.', channels: ['tiktok', 'instagram', 'pinterest'] },
];

function showcaseAccount(channel, brand) {
  const key = `fx_${channel}_${brand.slug}`;
  const handle = brand.slug;
  const base = { username: handle, displayName: brand.name };
  switch (channel) {
    case 'instagram': return { provider: 'instagram', accountKey: key, metadata: { ...base, accountId: key, igAccountId: key } };
    case 'facebook': return { provider: 'meta', accountKey: key, metadata: { pageId: key, pageName: brand.name, displayName: brand.name } };
    case 'tiktok': return { provider: 'tiktok', accountKey: key, metadata: { ...base, openId: key } };
    case 'threads': return { provider: 'threads', accountKey: key, metadata: { ...base, userId: key, threadsUserId: key } };
    case 'linkedin': return { provider: 'linkedin', accountKey: key, metadata: { linkedinDestinationName: brand.name, linkedinDestinationUrn: `urn:li:organization:${key}`, linkedinDestinationAccountId: key, linkedinDestinationType: 'page', linkedinPages: [{ id: key, urn: `urn:li:organization:${key}`, name: brand.name, role: 'ADMINISTRATOR' }], linkedinScopes: ['w_organization_social', 'r_organization_social', 'w_member_social', 'openid', 'profile'], displayName: brand.name, organizationId: key } };
    case 'pinterest': return { provider: 'pinterest', accountKey: key, metadata: { ...base, boardId: `${key}_board`, boardName: 'Inspiration' } };
    case 'x': return { provider: 'x', accountKey: key, metadata: { ...base, userId: key } };
    default: throw new Error(`Unknown channel ${channel}`);
  }
}

// ── content bank ────────────────────────────────────────────────────────────
// pillar → captions. `hook` marks a question opener the Intelligence
// fingerprint records as a hook; it also lifts engagement in the generator so
// the Playbook has a real pattern to find.
const CAPTIONS = [
  { pillar: 'Brew tips', hook: 'Is your pour-over bitter by the last sip?', body: 'Grind one step coarser and stop the pour 20 seconds earlier. Bitterness is almost always over-extraction, not the beans.' },
  { pillar: 'Brew tips', hook: 'How hot should your water actually be?', body: 'For light roasts, 94 to 96°C. Darker roasts forgive 90°C. Kettle off the boil for 30 seconds gets you there without a thermometer.' },
  { pillar: 'Brew tips', hook: null, body: 'Weigh your coffee. 15 grams to 250 grams of water is where most of our lots taste like themselves. Adjust from there, one variable at a time.' },
  { pillar: 'Brew tips', hook: 'Drinking coffee the day it was roasted?', body: 'Give it four days. The CO2 from roasting pushes water away from the grounds, and the cup tastes thin and sour until it settles.' },
  { pillar: 'Brew tips', hook: null, body: 'Paper filter tasting like paper? Rinse it with hot water first. It also preheats the brewer, which matters more than people think.' },
  { pillar: 'Brew tips', hook: 'Why does the same coffee taste different every morning?', body: 'Grinder retention. Purge a few grams before you dose, and clean the burrs every two weeks. Consistency is a cleaning problem.' },
  { pillar: 'Behind the roast', hook: null, body: 'Roast day. The Huila lot goes a touch lighter than last season: more stone fruit, less caramel. First cupping is Thursday.' },
  { pillar: 'Behind the roast', hook: 'Ever wonder what a roaster listens for?', body: 'First crack. The beans pop like popcorn when the moisture escapes, and the next ninety seconds decide the whole profile.' },
  { pillar: 'Behind the roast', hook: null, body: 'We cup every batch blind against last week. If this week loses, it does not ship. Three batches did not ship in August.' },
  { pillar: 'Behind the roast', hook: null, body: 'New drum arrives Monday. Same 12 kilo capacity, better airflow control, which means cleaner light roasts on the washed lots.' },
  { pillar: 'Origin stories', hook: null, body: 'Meet the Chelbesa washing station in Gedeb, Ethiopia. Around 700 smallholders deliver cherry here between October and January.' },
  { pillar: 'Origin stories', hook: 'What does "washed" actually mean on a bag?', body: 'The fruit is removed before drying, so the cup is cleaner and brighter. Natural process leaves the fruit on and tastes rounder.' },
  { pillar: 'Origin stories', hook: null, body: 'Our Colombia Huila comes from the Rodríguez family farm at 1,850 metres. We have bought their harvest four years running.' },
  { pillar: 'Origin stories', hook: null, body: 'Elevation, variety, process. Those three lines on the bag explain most of what you taste. Here is how to read them.' },
  { pillar: 'Community', hook: 'Who is coming to the Saturday cupping?', body: 'Ten seats, 10am, at the roastery. We open six coffees and argue about them. Beginners welcome, coffee provided.' },
  { pillar: 'Community', hook: null, body: 'Thank you to everyone who came out for the harvest fundraiser. We sent 4,200 dollars to the Chelbesa school this week.' },
  { pillar: 'Community', hook: null, body: 'The Sunday market stand is back. Bring your own cup and the first pour is on us.' },
  { pillar: 'Community', hook: 'What is the one brewer you would never give up?', body: 'Ours is a beaten-up Chemex from 2014. Tell us yours and we will feature a few next week.' },
  { pillar: 'New releases', hook: null, body: 'Autumn Blend is back. Brazil and Guatemala, roasted for milk drinks. Cocoa, toasted hazelnut, a soft finish.' },
  { pillar: 'New releases', hook: 'Ready for something bright?', body: 'Kenya Kiambu, AA grade, arrives Friday. Blackcurrant and tomato leaf on the nose, long grapefruit finish.' },
  { pillar: 'New releases', hook: null, body: 'Decaf that tastes like coffee. Our new Colombia sugarcane decaf keeps the chocolate and drops the caffeine. Limited run.' },
  { pillar: 'New releases', hook: null, body: 'Gift boxes are live: three 250g bags, a brew card, and a hand-thrown cup from a Portland potter. Ships in two days.' },
  { pillar: 'New releases', hook: 'Cold brew season is not over.', body: 'Our cold brew blend is now in 1 kg bags. Steep 12 hours at room temperature, dilute one to one.' },
  { pillar: 'Community', hook: null, body: 'Wholesale partner spotlight: Fern & Fog Bakery has poured our house blend every morning since 2022.' },
];

const HOURS_LOCAL = [7, 8, 9, 11, 12, 13, 16, 16, 17, 19];
const PUBLISHED_CHANNEL_MIX = ['instagram', 'instagram', 'instagram', 'instagram', 'instagram', 'instagram', 'instagram', 'instagram', 'instagram', 'instagram', 'instagram', 'instagram', 'instagram',
  'tiktok', 'tiktok', 'tiktok', 'tiktok', 'tiktok', 'tiktok', 'tiktok', 'tiktok',
  'threads', 'threads', 'threads', 'threads', 'threads', 'threads', 'threads', 'threads',
  'facebook', 'facebook', 'facebook', 'facebook', 'facebook', 'facebook',
  'linkedin', 'linkedin', 'linkedin', 'linkedin', 'x', 'x', 'x', 'pinterest', 'pinterest'];

const BASE_VIEWS = { instagram: [1400, 5200], tiktok: [2800, 14000], threads: [400, 2200], facebook: [600, 2400], linkedin: [300, 1200], x: [500, 2800], pinterest: [250, 900] };
const ENGAGEMENT_RATE = { instagram: [0.028, 0.055], tiktok: [0.035, 0.07], threads: [0.02, 0.045], facebook: [0.015, 0.035], linkedin: [0.02, 0.045], x: [0.012, 0.03], pinterest: [0.01, 0.025] };
const AVAILABILITY = {
  instagram: { impressions: 'available', views: 'available', reach: 'available', likes: 'available', comments: 'available', shares: 'available', saves: 'available', clicks: 'unsupported' },
  facebook: { impressions: 'available', views: 'available', reach: 'available', likes: 'available', comments: 'available', shares: 'available', saves: 'unsupported', clicks: 'available' },
  tiktok: { impressions: 'unsupported', views: 'available', reach: 'unsupported', likes: 'available', comments: 'available', shares: 'available', saves: 'available', clicks: 'unsupported' },
  threads: { impressions: 'available', views: 'available', reach: 'unsupported', likes: 'available', comments: 'available', shares: 'available', saves: 'unsupported', clicks: 'unsupported' },
  linkedin: { impressions: 'available', views: 'available', reach: 'available', likes: 'available', comments: 'available', shares: 'available', saves: 'unsupported', clicks: 'available' },
  x: { impressions: 'available', views: 'available', reach: 'unsupported', likes: 'available', comments: 'available', shares: 'available', saves: 'available', clicks: 'available' },
  pinterest: { impressions: 'available', views: 'available', reach: 'available', likes: 'available', comments: 'available', shares: 'available', saves: 'available', clicks: 'available' },
};
const UNSUPPORTED_ALWAYS = ['profileVisits', 'followersGained', 'watchTimeSeconds', 'averageWatchTimeSeconds', 'completionRate', 'conversions', 'videoViews'];

function iso(d) { return d.toISOString(); }
function utcDate(y, m, d, hLocal, min) { return new Date(Date.UTC(y, m - 1, d, hLocal - TZ_OFFSET_HOURS, min)); }
function dayKey(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { return new Date(d.getTime() + n * 86_400_000); }

function metricsFor(channel, publishedAt, caption, scale = 1) {
  const local = new Date(publishedAt.getTime() + TZ_OFFSET_HOURS * 3_600_000);
  const hour = local.getUTCHours();
  const weekday = local.getUTCDay();
  let lift = 1;
  if (hour === 16 && (weekday === 4 || weekday === 2)) lift *= 1.35; // Tue/Thu 4pm window
  if (caption.pillar === 'Brew tips') lift *= 1.25;
  if (caption.hook) lift *= 1.3;
  const [vLo, vHi] = BASE_VIEWS[channel];
  const [rLo, rHi] = ENGAGEMENT_RATE[channel];
  const views = round(between(vLo, vHi) * (0.85 + lift * 0.15) * scale);
  const rate = between(rLo, rHi) * lift;
  const engagements = Math.max(1, round(views * rate));
  const likes = round(engagements * 0.72);
  const comments = round(engagements * 0.09);
  const shares = round(engagements * 0.09);
  const savesRaw = engagements - likes - comments - shares;
  const avail = AVAILABILITY[channel];
  const val = (key, v) => (avail[key] === 'available' ? v : null);
  const m = {
    impressions: val('impressions', round(views * 1.08)),
    views,
    reach: val('reach', round(views * 0.68)),
    likes, comments, shares,
    saves: val('saves', Math.max(0, savesRaw)),
    clicks: val('clicks', round(views * between(0.004, 0.012))),
    profileVisits: null, followersGained: null, watchTimeSeconds: null, averageWatchTimeSeconds: null, completionRate: null, conversions: null, videoViews: null,
    raw: { views, likes, comments, shares },
    availability: {},
    source: { provider: CHANNEL_ACCOUNTS[channel].provider, apiVersion: 'fixture', measuredAt: iso(new Date()) },
  };
  for (const [k, state] of Object.entries(avail)) m.availability[k] = { state };
  for (const k of UNSUPPORTED_ALWAYS) m.availability[k] = { state: 'unsupported' };
  return m;
}
function scaleMetrics(m, f) {
  const out = { ...m, raw: { ...m.raw } };
  for (const k of ['impressions', 'views', 'reach', 'likes', 'comments', 'shares', 'saves', 'clicks']) if (typeof m[k] === 'number') out[k] = round(m[k] * f);
  for (const k of Object.keys(out.raw)) out.raw[k] = round(out.raw[k] * f);
  return out;
}
function engagementTotal(m) { return (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0); }

function fingerprintFor(caption, hasMedia) {
  const words = `${caption.hook ?? ''} ${caption.body}`.trim().split(/\s+/);
  const common = {
    schemaVersion: 1,
    topics: [caption.pillar.toLowerCase(), 'coffee'],
    pillar: caption.pillar,
    cta: caption.pillar === 'New releases' ? 'Order this week\'s roast' : null,
    keywords: words.filter((w) => w.length > 6).slice(0, 6).map((w) => w.replace(/[^a-z]/gi, '').toLowerCase()).filter(Boolean),
    sentiment: 'positive',
    structure: caption.hook ? ['question opener', 'one tip'] : ['statement', 'detail'],
    productPresence: caption.pillar === 'New releases' || caption.pillar === 'Behind the roast',
    humanPresence: caption.pillar === 'Community',
    hook: caption.hook,
    openingStyle: caption.hook ? 'question' : 'statement',
    conversationPotential: caption.hook ? 72 : 38,
    professionalValue: caption.pillar === 'Brew tips' ? 70 : 45,
    searchEvergreenFit: caption.pillar === 'Brew tips' || caption.pillar === 'Origin stories' ? 78 : 40,
  };
  return hasMedia
    ? { kind: 'image', ...common, ocrText: [], aspectRatio: '4:5', visualSubjects: ['coffee'], visualStyle: 'warm studio still life' }
    : { kind: 'text', ...common, wordCount: words.length };
}

function socialPostId(channel, accountKey, externalId) {
  return createHash('sha256').update(`${channel}\0${accountKey}\0${externalId}`).digest('base64url').slice(0, 40);
}
function downloadUrl(filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

// ── plan ────────────────────────────────────────────────────────────────────
async function plan() {
  const now = new Date();
  const seededAt = iso(now);
  const files = MEDIA_DIR ? readdirSync(MEDIA_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort() : [];
  const images = files.filter((f) => !/^logo\./i.test(f));
  const logo = files.find((f) => /^logo\./i.test(f)) ?? null;
  if (images.length === 0) throw new Error('DEMO_MEDIA_DIR must contain the generated demo images.');

  const media = images.map((file) => {
    const name = path.parse(file).name;
    const ext = path.extname(file).toLowerCase().replace('.', '').replace('jpeg', 'jpg');
    const storagePath = `workspaces/${DEMO_WS_ID}/uploads/demo_${name}.${ext}`;
    const token = randomUUID();
    return { id: `ast_demo_${name}`, file, storagePath, token, downloadUrl: downloadUrl(storagePath, token), mimeType: ext === 'png' ? 'image/png' : 'image/jpeg', refCount: 0 };
  });
  const logoUpload = logo ? { file: logo, storagePath: `workspaces/${DEMO_WS_ID}/brand/logo.png`, token: randomUUID() } : null;
  if (logoUpload) logoUpload.downloadUrl = downloadUrl(logoUpload.storagePath, logoUpload.token);

  // Published: 44 posts across the eight weeks before today.
  const firstDay = addDays(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), -57);
  const published = [];
  const mix = [...PUBLISHED_CHANNEL_MIX];
  const total = mix.length;
  for (let i = 0; i < total; i++) {
    const channel = mix.splice(Math.floor(rand() * mix.length), 1)[0];
    // Front-load the last ten days so the dashboard's 7-day chart and the
    // analytics window have something to show.
    const dayOffset = i >= total - 14 ? 47 + Math.floor(((i - (total - 14)) / 14) * 10) : Math.min(46, Math.floor((i / (total - 14)) * 47 + rand() * 1.6));
    const day = addDays(firstDay, dayOffset);
    const hour = pick(HOURS_LOCAL);
    const publishedAt = utcDate(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, [5, 15, 30, 45][Math.floor(rand() * 4)]);
    if (publishedAt >= now) continue;
    const caption = CAPTIONS[i % CAPTIONS.length];
    const asset = media[i % media.length];
    const useMedia = channel !== 'threads' || rand() > 0.4;
    if (useMedia) asset.refCount++;
    const content = caption.hook ? `${caption.hook} ${caption.body}` : caption.body;
    const metrics = metricsFor(channel, publishedAt, caption);
    const externalId = `fx_${channel}_${String(i + 1).padStart(3, '0')}`;
    published.push({ index: i + 1, id: `demo_pub_${String(i + 1).padStart(3, '0')}`, channel, caption, content, publishedAt, metrics, externalId, asset: useMedia ? asset : null });
  }

  // Scheduled: the rest of this month, one or two a day on most days.
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const scheduled = [];
  let sIndex = 0;
  for (let d = now.getUTCDate() + 1; d <= monthEnd; d++) {
    const weekday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d)).getUTCDay();
    const count = weekday === 0 ? 1 : d % 4 === 0 ? 3 : 2;
    for (let c = 0; c < count; c++) {
      const channel = ['instagram', 'tiktok', 'threads', 'facebook', 'linkedin', 'pinterest', 'x'][(sIndex + c * 3) % 7];
      const caption = CAPTIONS[(sIndex + 7) % CAPTIONS.length];
      const asset = media[(sIndex + 5) % media.length];
      asset.refCount++;
      const scheduledAt = utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, d, [9, 13, 17][c] ?? 11, c === 0 ? 0 : 30);
      scheduled.push({ id: `demo_sched_${String(++sIndex).padStart(3, '0')}`, channel, caption, content: caption.hook ? `${caption.hook} ${caption.body}` : caption.body, scheduledAt, asset });
    }
  }
  const drafts = [
    { id: 'demo_draft_001', channel: 'instagram', content: 'Kenya Kiambu tasting notes, take two. Blackcurrant, grapefruit, and something like tomato leaf on the nose. Photos from Friday\'s cupping.', asset: media[1] },
    { id: 'demo_draft_002', channel: 'linkedin', content: 'Three things we learned running a roastery for five years: buy less green coffee than you think, cup blind, and pay for the good grinder.', asset: null },
    { id: 'demo_draft_003', channel: 'tiktok', content: 'The 20-second fix for bitter pour-over. Watch the kettle, not the clock.', asset: media[3] },
  ];
  for (const d of drafts) if (d.asset) d.asset.refCount++;

  // Rollups.
  const daily = new Map();
  const activity = new Map();
  for (const p of published) {
    const date = dayKey(p.publishedAt);
    const day = daily.get(date) ?? { date, channels: {}, byProduct: { [PRODUCT_ID]: { posts: 0, channels: {} } }, posts: 0 };
    const bump = (agg) => {
      agg.posts++;
      const m = p.metrics;
      if (m.views !== null) { agg.views += m.views; agg.postsWithViews++; }
      if (m.reach !== null) { agg.reach += m.reach; agg.postsWithReach++; }
      for (const k of ['likes', 'comments', 'shares', 'saves', 'clicks']) if (m[k] !== null) agg[k] += m[k];
      agg.engagements += engagementTotal(m); agg.postsWithEngagements++;
    };
    const empty = () => ({ posts: 0, views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, engagements: 0, postsWithViews: 0, postsWithReach: 0, postsWithEngagements: 0 });
    bump(day.channels[p.channel] ?? (day.channels[p.channel] = empty()));
    bump(day.byProduct[PRODUCT_ID].channels[p.channel] ?? (day.byProduct[PRODUCT_ID].channels[p.channel] = empty()));
    day.byProduct[PRODUCT_ID].posts++; day.posts++;
    daily.set(date, day);
    const act = activity.get(date) ?? { date };
    const add = (key, v) => { if (typeof v === 'number') act[key] = (act[key] ?? 0) + v; };
    for (const k of ['views', 'reach', 'likes', 'comments', 'shares', 'saves']) { add(`channels.${p.channel}.${k}`, p.metrics[k]); add(`byProduct.${PRODUCT_ID}.channels.${p.channel}.${k}`, p.metrics[k]); }
    add(`channels.${p.channel}.engagements`, engagementTotal(p.metrics)); add(`byProduct.${PRODUCT_ID}.channels.${p.channel}.engagements`, engagementTotal(p.metrics));
    activity.set(date, act);
  }

  // Follower series, one snapshot per channel per day.
  const FOLLOWERS = { instagram: [3840, 4610], tiktok: [6120, 7980], facebook: [2210, 2290], threads: [910, 1340], linkedin: [640, 720], pinterest: [1480, 1530], x: [1150, 1260] };
  const audience = [];
  const totalDays = 58;
  for (let i = 0; i < totalDays; i++) {
    const day = addDays(firstDay, i);
    const date = dayKey(day);
    for (const [channel, [start, end]] of Object.entries(FOLLOWERS)) {
      const t = i / (totalDays - 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const followers = round(start + (end - start) * eased + Math.sin(i * 1.7) * 3);
      audience.push({ id: `${date}_${channel}_${CHANNEL_ACCOUNTS[channel].accountKey}`, date, channel, provider: CHANNEL_ACCOUNTS[channel].provider, productId: PRODUCT_ID, accountKey: CHANNEL_ACCOUNTS[channel].accountKey, followers, capturedAt: `${date}T00:00:35.000Z` });
    }
  }

  return { seededAt, media, logoUpload, published, scheduled, drafts, daily: [...daily.values()], activity: [...activity.values()], audience };
}

// ── write ───────────────────────────────────────────────────────────────────
async function uploadFile(storagePath, buffer, contentType, token) {
  const file = admin.storage().bucket().file(storagePath);
  await file.save(buffer, { resumable: false, metadata: { contentType, cacheControl: 'private, max-age=3600', metadata: { firebaseStorageDownloadTokens: token, screenshotFixture: 'true' } } });
}

async function commitAll(writes) {
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 400)) batch.set(w.ref, w.data, w.merge ? { merge: true } : undefined);
    await batch.commit();
  }
}

async function apply(user, p) {
  const uid = user.uid;
  const ws = db.collection('workspaces').doc(DEMO_WS_ID);
  const product = ws.collection('products').doc(PRODUCT_ID);
  const writes = [];
  const seededAt = p.seededAt;

  // Drop stale fixture docs from earlier runs (ids not in this plan) so a
  // re-apply never leaves orphans with dead media URLs behind.
  const plannedPostIds = new Set([...p.published, ...p.scheduled, ...p.drafts].map((x) => x.id));
  const plannedSocialIds = new Set(p.published.map((x) => socialPostId(x.channel, CHANNEL_ACCOUNTS[x.channel].accountKey, x.externalId)));
  const plannedMediaIds = new Set(p.media.map((m) => m.id));
  const plannedProductIds = new Set([PRODUCT_ID, ...SHOWCASE_BRANDS.map((b) => b.id)]);
  const wsSnap = await ws.get();
  if (wsSnap.exists && wsSnap.data()?.fixtureFlags?.[FIXTURE_KEY]) {
    let stale = 0;
    for (const [coll, keep] of [['posts', plannedPostIds], ['socialPosts', plannedSocialIds], ['media_assets', plannedMediaIds], ['products', plannedProductIds]]) {
      const snap = await ws.collection(coll).select().get();
      for (const d of snap.docs) if (!keep.has(d.id)) { await db.recursiveDelete(d.ref); stale++; }
    }
    if (stale) console.log(`Removed ${stale} stale fixture documents from earlier runs.`);
  }

  // Storage first so URLs resolve when the docs land.
  for (const m of p.media) {
    const buffer = readFileSync(path.join(MEDIA_DIR, m.file));
    m.sizeBytes = buffer.length;
    await uploadFile(m.storagePath, buffer, m.mimeType, m.token);
  }
  let logoUrl = '';
  if (p.logoUpload) {
    await uploadFile(p.logoUpload.storagePath, readFileSync(path.join(MEDIA_DIR, p.logoUpload.file)), 'image/png', p.logoUpload.token);
    logoUrl = p.logoUpload.downloadUrl;
  }

  writes.push({ ref: ws, merge: true, data: {
    name: BRAND.name, slug: DEMO_WS_ID, createdAt: seededAt, createdBy: uid, updatedAt: seededAt,
    fixtureFlags: { [FIXTURE_KEY]: { enabled: true, version: FIXTURE_VERSION, accountEmail: EXPECTED_EMAIL, ownerUid: uid, seededAt, productId: PRODUCT_ID, counts: { published: p.published.length, scheduled: p.scheduled.length, drafts: p.drafts.length, media: p.media.length } } },
  } });
  writes.push({ ref: ws.collection('members').doc(uid), data: { uid, email: EXPECTED_EMAIL, role: 'owner', joinedAt: seededAt } });
  writes.push({ ref: db.collection('subscriptions').doc(DEMO_WS_ID), data: {
    workspaceId: DEMO_WS_ID, tier: 'business', status: 'active', interval: 'annual', cancelAtPeriodEnd: false, trialEnd: null,
    stripeCustomerId: 'manual_grant_marketing_demo', stripeSubscriptionId: 'manual_grant_marketing_demo', stripePriceId: '',
    compedBy: 'manual grant (marketing screenshot demo workspace)', currentPeriodEnd: '2027-12-31T00:00:00.000Z', updatedAt: seededAt,
  } });
  writes.push({ ref: product, data: {
    name: BRAND.name, description: BRAND.description, url: BRAND.url, categories: BRAND.categories, status: 'active',
    brandVoice: BRAND.brandVoice, brandIdentity: { ...BRAND.brandIdentity, logoUrl },
    workspaceId: DEMO_WS_ID, createdBy: uid, createdAt: seededAt, updatedAt: seededAt, screenshotFixture: true,
  } });
  for (const [channel, acct] of Object.entries(CHANNEL_ACCOUNTS)) {
    const connectionId = `${acct.provider}:${acct.accountKey}`;
    writes.push({ ref: product.collection('platformConnections').doc(connectionId), data: {
      provider: acct.provider, connectionId, accountKey: acct.accountKey, accountLabel: BRAND.name, channels: [channel],
      capabilities: ['publish_text', 'publish_image', 'publish_video', 'publish_carousel'], status: 'connected',
      accessTokenEncrypted: 'fixture', tokenExpiresAt: '2030-01-01T00:00:00.000Z', metadata: acct.metadata,
      workspaceId: DEMO_WS_ID, productId: PRODUCT_ID, updatedBy: uid, updatedAt: seededAt, createdAt: seededAt,
      fixture: true, screenshotFixture: true,
    } });
  }
  for (const brand of SHOWCASE_BRANDS) {
    const ref = ws.collection('products').doc(brand.id);
    const at = iso(addDays(new Date(seededAt), -brand.daysAgo));
    writes.push({ ref, data: {
      name: brand.name, description: brand.description, url: brand.url, categories: brand.categories, status: 'active',
      workspaceId: DEMO_WS_ID, createdBy: uid, createdAt: at, updatedAt: at, screenshotFixture: true,
    } });
    for (const channel of brand.channels) {
      const acct = showcaseAccount(channel, brand);
      const connectionId = `${acct.provider}:${acct.accountKey}`;
      writes.push({ ref: ref.collection('platformConnections').doc(connectionId), data: {
        provider: acct.provider, connectionId, accountKey: acct.accountKey, accountLabel: brand.name, channels: [channel],
        capabilities: ['publish_text', 'publish_image', 'publish_video', 'publish_carousel'], status: 'connected',
        accessTokenEncrypted: 'fixture', tokenExpiresAt: '2030-01-01T00:00:00.000Z', metadata: acct.metadata,
        workspaceId: DEMO_WS_ID, productId: brand.id, updatedBy: uid, updatedAt: at, createdAt: at,
        fixture: true, screenshotFixture: true,
      } });
    }
  }
  for (const m of p.media) {
    writes.push({ ref: ws.collection('media_assets').doc(m.id), data: {
      id: m.id, type: 'image', storagePath: m.storagePath, downloadUrl: m.downloadUrl, mimeType: m.mimeType, sizeBytes: m.sizeBytes,
      originalFileName: m.file, createdByType: 'user', createdById: uid, createdAt: seededAt, refCount: m.refCount, orphanedAt: null,
      processingState: 'ready', processedAt: seededAt, thumbnailUrl: m.downloadUrl, width: 1080, height: 1350, screenshotFixture: true,
    } });
  }
  const acctFor = (channel) => CHANNEL_ACCOUNTS[channel];
  for (const post of p.published) {
    const ref = ws.collection('posts').doc(post.id);
    const publishedAt = iso(post.publishedAt);
    const mediaUrls = post.asset ? [post.asset.downloadUrl] : [];
    writes.push({ ref, data: {
      workspaceId: DEMO_WS_ID, productId: PRODUCT_ID, createdBy: uid, updatedBy: uid, content: post.content, channel: post.channel, targetChannels: [post.channel],
      publishedChannels: [post.channel], channelDeliveryModes: { [post.channel]: 'direct_publish' }, channelDestinations: { [post.channel]: acctFor(post.channel).accountKey },
      mediaUrls, status: 'published', scheduledAt: null, publishedAt, publishStartedAt: publishedAt, publishFinishedAt: publishedAt,
      externalId: post.externalId, externalUrl: null, publishResults: [{ channel: post.channel, success: true, externalId: post.externalId }],
      publishAttemptCount: 1, errorMessage: '', lastErrorCode: '', lastErrorCategory: '', nextRetryAt: null,
      metricsByChannel: { [post.channel]: post.metrics }, metricsStatus: 'complete', metricsUpdatedAt: seededAt, metricsAttempts: 0,
      testMode: false, screenshotFixture: true, screenshotFixtureVersion: FIXTURE_VERSION, createdAt: publishedAt, updatedAt: seededAt,
    } });
    for (const [stageKey, factor, hours] of [['1h', 0.18, 1], ['24h', 0.72, 24], ['7d', 1, 168]]) {
      const capturedAt = new Date(post.publishedAt.getTime() + hours * 3_600_000);
      if (capturedAt > new Date()) continue;
      writes.push({ ref: ref.collection('metrics').doc(stageKey), data: { postId: post.id, stageKey, capturedAt: iso(capturedAt), publishedAt, byChannel: { [post.channel]: scaleMetrics(post.metrics, factor) } } });
    }
    const spId = socialPostId(post.channel, acctFor(post.channel).accountKey, post.externalId);
    const spRef = ws.collection('socialPosts').doc(spId);
    writes.push({ ref: spRef, data: {
      id: spId, workspaceId: DEMO_WS_ID, productId: PRODUCT_ID, campaignId: null, markaestroPostId: post.id, provenance: 'markaestro',
      platform: post.channel, provider: acctFor(post.channel).provider, accountKey: acctFor(post.channel).accountKey,
      accountUsername: acctFor(post.channel).metadata.username ?? acctFor(post.channel).metadata.pageName ?? BRAND.name,
      externalId: post.externalId, content: post.content, mediaUrls, ...(mediaUrls[0] ? { thumbnailUrl: mediaUrls[0] } : {}),
      publishedAt, latestMetrics: post.metrics, metricsUpdatedAt: seededAt, firstSeenAt: publishedAt, updatedAt: seededAt, schemaVersion: 1,
      fingerprint: fingerprintFor(post.caption, Boolean(post.asset)), fingerprintedAt: seededAt, screenshotFixture: true,
    } });
    writes.push({ ref: spRef.collection('metrics').doc('latest'), data: { snapshotId: 'latest', socialPostId: spId, platform: post.channel, capturedAt: seededAt, stageKey: 'latest', metrics: post.metrics, schemaVersion: 1 } });
  }
  for (const post of p.scheduled) {
    writes.push({ ref: ws.collection('posts').doc(post.id), data: {
      workspaceId: DEMO_WS_ID, productId: PRODUCT_ID, createdBy: uid, updatedBy: uid, content: post.content, channel: post.channel, targetChannels: [post.channel],
      channelDeliveryModes: { [post.channel]: 'direct_publish' }, channelDestinations: { [post.channel]: acctFor(post.channel).accountKey },
      mediaUrls: [post.asset.downloadUrl], status: 'scheduled', scheduledAt: iso(post.scheduledAt), publishedAt: null,
      testMode: true, screenshotFixture: true, screenshotFixtureVersion: FIXTURE_VERSION, createdAt: seededAt, updatedAt: seededAt,
    } });
  }
  for (const post of p.drafts) {
    writes.push({ ref: ws.collection('posts').doc(post.id), data: {
      workspaceId: DEMO_WS_ID, productId: PRODUCT_ID, createdBy: uid, updatedBy: uid, content: post.content, channel: post.channel, targetChannels: [post.channel],
      mediaUrls: post.asset ? [post.asset.downloadUrl] : [], status: 'draft', scheduledAt: null, publishedAt: null,
      testMode: true, screenshotFixture: true, screenshotFixtureVersion: FIXTURE_VERSION, createdAt: seededAt, updatedAt: seededAt,
    } });
  }
  for (const day of p.daily) writes.push({ ref: ws.collection('analyticsDaily').doc(day.date), data: { ...day, updatedAt: seededAt } });
  for (const act of p.activity) writes.push({ ref: ws.collection('analyticsActivity').doc(act.date), data: { ...act, updatedAt: seededAt } });
  for (const snap of p.audience) writes.push({ ref: ws.collection('audienceSnapshots').doc(snap.id), data: snap });
  writes.push({ ref: product.collection('intelligence').doc('profile'), data: {
    schemaVersion: 1, objective: 'engagement', customObjective: '',
    targetMarkets: [{ code: 'US', label: 'United States', weight: 70, priority: 'primary' }, { code: 'CA', label: 'Canada', weight: 30, priority: 'secondary' }],
    ageBands: [{ min: 25, max: 44, weight: 70 }, { min: 45, max: 60, weight: 30 }], genderFocus: ['all'],
    industries: ['Food & beverage', 'Specialty retail'], interests: ['Home brewing', 'Cooking', 'Sustainability'],
    personas: [{ name: 'The weekend brewer', description: 'Owns a grinder and a pour-over cone, wants repeatable results without buying more gear.' }],
    brandVoice: ['warm', 'plainspoken', 'specific', 'curious'], contentPillars: ['Brew tips', 'Behind the roast', 'Origin stories', 'Community', 'New releases'],
    businessDescription: BRAND.description, conversionAction: 'website_visit', customConversionAction: '', conversionDestination: BRAND.url,
    primaryTimezone: 'America/Los_Angeles', platformPriorities: [{ platform: 'instagram', priority: 1 }, { platform: 'tiktok', priority: 2 }, { platform: 'threads', priority: 3 }],
    excludedAudiences: [], excludedMarkets: [], updatedAt: seededAt, updatedBy: uid,
  } });

  await commitAll(writes);
  return writes.length;
}

async function reset() {
  const ws = db.collection('workspaces').doc(DEMO_WS_ID);
  const snap = await ws.get();
  if (!snap.exists) { console.log('Demo workspace does not exist; nothing to reset.'); return; }
  if (!snap.data()?.fixtureFlags?.[FIXTURE_KEY]) throw new Error(`Refusing to delete ${DEMO_WS_ID}: it does not carry fixtureFlags.${FIXTURE_KEY}.`);
  await db.recursiveDelete(ws);
  await db.collection('subscriptions').doc(DEMO_WS_ID).delete();
  await admin.storage().bucket().deleteFiles({ prefix: `workspaces/${DEMO_WS_ID}/` });
  console.log(`Deleted demo workspace ${DEMO_WS_ID}, its subscription and its Storage prefix.`);
}

async function run() {
  const user = await auth.getUserByEmail(EXPECTED_EMAIL);
  if (RESET) { await reset(); return; }
  const p = await plan();
  const summary = {
    mode: APPLY ? 'apply' : 'dry-run', projectId, bucket: BUCKET, email: EXPECTED_EMAIL, uid: user.uid, workspaceId: DEMO_WS_ID, productId: PRODUCT_ID, brand: BRAND.name, showcaseBrands: SHOWCASE_BRANDS.length,
    media: p.media.length, logo: Boolean(p.logoUpload), published: p.published.length, scheduled: p.scheduled.length, drafts: p.drafts.length,
    dailyRollups: p.daily.length, activityDays: p.activity.length, audienceSnapshots: p.audience.length,
    publishedByChannel: p.published.reduce((a, x) => ((a[x.channel] = (a[x.channel] ?? 0) + 1), a), {}),
    publishedRange: [iso(p.published[0].publishedAt).slice(0, 10), iso(p.published.at(-1).publishedAt).slice(0, 10)],
    scheduledRange: [iso(p.scheduled[0].scheduledAt).slice(0, 10), iso(p.scheduled.at(-1).scheduledAt).slice(0, 10)],
    totalViews: p.published.reduce((a, x) => a + x.metrics.views, 0),
    totalEngagements: p.published.reduce((a, x) => a + engagementTotal(x.metrics), 0),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!APPLY) { console.log('\nDry run only. Re-run with --apply to write the demo workspace.'); return; }
  const count = await apply(user, p);
  console.log(`\nWrote ${count} documents into ${DEMO_WS_ID}.`);
}

run().catch((error) => { console.error(error); process.exit(1); });
