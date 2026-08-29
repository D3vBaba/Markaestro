#!/usr/bin/env node
/**
 * Hold the platform capability registry to the channel catalog it describes.
 *
 * `PLATFORM_CAPABILITY_REGISTRY[channel].publishing` and the catalog's
 * `mediaKinds` are two statements of one fact, and they had already drifted:
 * the registry declared `pinterest.publishing.carousel: false` while the
 * catalog allowed five media items and the adapter built a real multi-image
 * pin. Two of the three were right; the declared contract was the one that was
 * wrong, and nothing was checking it.
 *
 * A unit test covers the same assertion. This exists as a script as well
 * because it also checks the direction a unit test cannot reach: the adapter
 * constants that encode a platform ceiling in a third place.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORM_CAPABILITY_REGISTRY, publishingCapabilitiesFor } from '@/lib/platform/capabilities';
import { getSocialChannelConfig, socialChannelCatalog } from '@/lib/social/channel-catalog';
import { socialChannels } from '@/lib/schemas';

const ROOT = process.cwd();
const failures = [];

// ── Registry against catalog ────────────────────────────────────────────────
for (const channel of socialChannels) {
  const declared = PLATFORM_CAPABILITY_REGISTRY[channel]?.publishing;
  if (!declared) {
    failures.push(`${channel}: no publishing block in PLATFORM_CAPABILITY_REGISTRY.`);
    continue;
  }
  const derived = publishingCapabilitiesFor(channel);
  for (const [key, value] of Object.entries(derived)) {
    if (declared[key] !== value) {
      failures.push(
        `${channel}.publishing.${key}: registry says ${JSON.stringify(declared[key])}, the catalog implies ${JSON.stringify(value)}.`,
      );
    }
  }
}

// ── Adapter media ceilings against the catalog ──────────────────────────────
/**
 * Where an adapter hardcodes the same number the catalog carries. A mismatch
 * is the silent-truncation bug in waiting: validation rejects against the
 * catalog, the adapter slices against its own constant, and the two only agree
 * by luck.
 */
const ADAPTER_CEILINGS = [
  { channel: 'threads', file: 'src/lib/platform/adapters/threads-publishing.ts', constant: 'MAX_CAROUSEL_ITEMS' },
  { channel: 'instagram', file: 'src/lib/platform/adapters/meta-publishing.ts', constant: 'IG_MAX_CAROUSEL_ITEMS' },
  { channel: 'pinterest', file: 'src/lib/platform/adapters/pinterest-publishing.ts', constant: 'MAX_PIN_IMAGES' },
];

for (const { channel, file, constant } of ADAPTER_CEILINGS) {
  let source;
  try {
    source = readFileSync(join(ROOT, file), 'utf8');
  } catch {
    failures.push(`${file}: not found. Update ADAPTER_CEILINGS in this script.`);
    continue;
  }
  const match = source.match(new RegExp(`const\\s+${constant}\\s*=\\s*(\\d+)`));
  if (!match) {
    failures.push(`${file}: could not find \`${constant}\`. Update ADAPTER_CEILINGS in this script.`);
    continue;
  }
  const adapterLimit = Number(match[1]);
  const catalogLimit = getSocialChannelConfig(channel)?.maxMediaItems;
  if (adapterLimit !== catalogLimit) {
    failures.push(
      `${channel}: ${constant} is ${adapterLimit} but the catalog allows ${catalogLimit}. ` +
      'Whichever is right, they have to agree, or validation and the adapter disagree about what a valid post is.',
    );
  }
}

// ── The catalog carries no field nothing reads ──────────────────────────────
const READ_FIELDS = [
  'channel',
  'label',
  'providerKeys',
  'maxLength',
  'mediaKinds',
  'mediaRequired',
  'maxMediaItems',
  'supportsDirectPublish',
  'setupHint',
].sort();

for (const entry of socialChannelCatalog) {
  const keys = Object.keys(entry).sort();
  const unread = keys.filter((key) => !READ_FIELDS.includes(key));
  const missing = READ_FIELDS.filter((key) => !keys.includes(key));
  if (unread.length > 0) {
    failures.push(
      `${entry.channel}: catalog field(s) ${unread.join(', ')} have no reader. ` +
      'Give them a consumer or delete them; an unread field is how tiktok.supportsDirectPublish stayed wrong.',
    );
  }
  if (missing.length > 0) {
    failures.push(`${entry.channel}: catalog is missing ${missing.join(', ')}.`);
  }
}

if (failures.length > 0) {
  console.error(`\nCapability parity violations (${failures.length}):`);
  for (const entry of failures) console.error(`  - ${entry}`);
  process.exit(1);
}

console.log(`check-capability-parity passed (${socialChannels.length} channels)`);
