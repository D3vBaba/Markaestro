/**
 * Find webhook endpoints that would now fail the SSRF guard, and optionally
 * disable them.
 *
 * Before the guard landed, `registerWebhookEndpointSchema` validated the URL
 * with `z.url()` and nothing else: no scheme restriction and no host checks.
 * So endpoints already in the database may point at `localhost`, a private
 * range, or `169.254.169.254`. Those keep being delivered to until something
 * stops them, and delivery records the response status per attempt, which is
 * enough to map an internal network.
 *
 * New registrations are refused at both registration and delivery time. This
 * script deals with the ones already stored: it reports them so their owners
 * can be told, and can disable them so they stop being delivered to in the
 * meantime. Disabling rather than deleting keeps the endpoint visible to the
 * customer so they can fix the URL, matching how "delete" already works.
 *
 * Usage:
 *
 *   # Report only. Writes nothing. Start here.
 *   node scripts/audit-webhook-endpoints.mjs
 *
 *   # Disable every endpoint that fails the check
 *   node scripts/audit-webhook-endpoints.mjs --disable
 *
 *   # One workspace
 *   node scripts/audit-webhook-endpoints.mjs --workspace=ws_abc123
 */

import admin from 'firebase-admin';
import dns from 'node:dns/promises';
import net from 'node:net';

const DISABLE = process.argv.includes('--disable');
const WORKSPACE_ARG = process.argv.find((arg) => arg.startsWith('--workspace='));
const ONLY_WORKSPACE = WORKSPACE_ARG ? WORKSPACE_ARG.split('=')[1] : null;

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}

const db = admin.firestore();

// Mirrors src/lib/network-security.ts. Kept as a copy rather than an import
// because this is a plain .mjs script with no TypeScript path resolution; if
// the guard's rules change, change them here too.
const DISALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'metadata.google.internal']);
const DISALLOWED_SUFFIXES = ['.localhost', '.local', '.localdomain', '.internal', '.home.arpa'];

function ipv4ToNumber(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0);
}

function isPrivateIpv4(ip) {
  const value = ipv4ToNumber(ip);
  const ranges = [
    ['0.0.0.0', '0.255.255.255'],
    ['10.0.0.0', '10.255.255.255'],
    ['100.64.0.0', '100.127.255.255'],
    ['127.0.0.0', '127.255.255.255'],
    ['169.254.0.0', '169.254.255.255'],
    ['172.16.0.0', '172.31.255.255'],
    ['192.0.0.0', '192.0.0.255'],
    ['192.168.0.0', '192.168.255.255'],
    ['198.18.0.0', '198.19.255.255'],
    ['224.0.0.0', '255.255.255.255'],
  ];
  return ranges.some(([start, end]) => value >= ipv4ToNumber(start) && value <= ipv4ToNumber(end));
}

function isPrivateIpv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fe80:') ||
      normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

function isPrivateIp(address) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return false;
}

/** Returns the rule that failed, or null when the URL is acceptable. */
async function checkUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 'not a valid URL';
  }
  if (parsed.protocol !== 'https:') return `scheme is ${parsed.protocol.replace(':', '')}, not https`;
  if (parsed.username || parsed.password) return 'URL carries credentials';

  const hostname = parsed.hostname.trim().replace(/\.+$/, '').toLowerCase();
  if (!hostname) return 'no hostname';
  if (DISALLOWED_HOSTS.has(hostname)) return `host ${hostname} is blocked`;
  if (DISALLOWED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return `host ${hostname} is an internal name`;
  if (net.isIP(hostname)) {
    return isPrivateIp(hostname) ? `host ${hostname} is a private address` : null;
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    const priv = addresses.slice(0, 10).find(({ address }) => isPrivateIp(address));
    return priv ? `${hostname} resolves to the private address ${priv.address}` : null;
  } catch (error) {
    return `${hostname} does not resolve (${error.code || error.message})`;
  }
}

async function main() {
  console.log(DISABLE ? '\nDisabling endpoints that fail the check.\n' : '\nReport only. Pass --disable to act.\n');

  const snap = ONLY_WORKSPACE
    ? await db.collection(`workspaces/${ONLY_WORKSPACE}/webhook_endpoints`).get()
    : await db.collectionGroup('webhook_endpoints').get();

  let active = 0;
  const failures = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.status !== 'active') continue;
    active++;
    const reason = await checkUrl(String(data.url || ''));
    if (!reason) continue;

    const workspaceId = doc.ref.path.split('/')[1];
    failures.push({ workspaceId, id: doc.id, url: data.url, reason, ref: doc.ref });
  }

  for (const failure of failures) {
    console.log(`  ${failure.workspaceId}/${failure.id}`);
    console.log(`    url:    ${failure.url}`);
    console.log(`    reason: ${failure.reason}`);
    if (DISABLE) {
      await failure.ref.set({
        status: 'disabled',
        disabledReason: 'BLOCKED_BY_SSRF_GUARD',
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      console.log('    disabled');
    }
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Active endpoints checked: ${active}`);
  console.log(`Endpoints that fail the guard: ${failures.length}`);
  if (failures.length > 0) {
    if (DISABLE) console.log('Disabled. Tell the owners so they can re-register with a reachable https URL.');
    else console.log('Run again with --disable to stop delivering to them.');
    console.log('Owners to contact: ' + [...new Set(failures.map((f) => f.workspaceId))].join(', '));
  }
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
