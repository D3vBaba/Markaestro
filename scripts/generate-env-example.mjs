#!/usr/bin/env node
/**
 * Derive `.env.local.example` from `apphosting.yaml`.
 *
 * The shape of a working `.env.local` was only discoverable by reading the
 * deployment config, which is why getting from a clone to a running app was
 * guesswork (and why six `.env.local.bak.*` files accumulated next to it).
 *
 * Derived rather than hand-written so it cannot drift: a variable added to the
 * deployment appears here on the next run, and CI fails if the committed file
 * no longer matches.
 *
 * Values are never copied. Plain `value:` entries in apphosting.yaml are
 * public configuration and their defaults are reproduced; anything with a
 * `secret:` reference is emitted as an empty placeholder, because the whole
 * point of Secret Manager is that the value is not in the repository.
 *
 * Usage:
 *   node scripts/generate-env-example.mjs
 *   node scripts/generate-env-example.mjs --check
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SOURCE = join(ROOT, 'apphosting.yaml');
const OUTPUT = join(ROOT, '.env.local.example');
const check = process.argv.includes('--check');

/**
 * What a contributor needs before the app will boot at all, as opposed to what
 * unlocks a particular integration. Someone working on the composer should not
 * have to register six OAuth apps first.
 */
const REQUIRED_TO_BOOT = new Set([
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'NEXT_PUBLIC_APP_URL',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'ENCRYPTION_KEY',
]);

/**
 * A one-line note for variables whose name does not explain them. Only where
 * it earns its place: a comment restating the variable name is noise.
 */
const NOTES = {
  ENCRYPTION_KEY: 'Any long random string locally. Encrypts stored OAuth tokens.',
  FIREBASE_SERVICE_ACCOUNT_JSON: 'The whole service account JSON on one line, or use `gcloud auth application-default login` instead and leave this empty.',
  WORKER_SECRET: 'Shared secret the scheduler sends to /api/worker/*. Any string locally.',
  CONVERSION_INGEST_SECRET: 'Root secret that per-workspace conversion ingest keys are derived from.',
  RESEND_FROM: 'Sender address for transactional email. Sends are skipped locally when RESEND_API_KEY is empty.',
  VERTEX_AI_PROJECT: 'Leave empty to disable the AI features rather than to break them.',
  INTELLIGENCE_PREVIEW_EMAILS: 'Comma separated. Adds accounts to the Intelligence private preview without a deploy.',
  INTELLIGENCE_PREVIEW_UIDS: 'Comma separated, as above but by uid.',
};

/** Variables the app reads that the deployment does not declare. */
const EXTRA = [
  { variable: 'INTELLIGENCE_PREVIEW_EMAILS', value: '', secret: false },
  { variable: 'INTELLIGENCE_PREVIEW_UIDS', value: '', secret: false },
  { variable: 'PUBLIC_API_AUTH_CACHE_TTL_MS', value: '15000', secret: false },
];

/**
 * A deliberately small YAML reader: this file has one shape, and it is
 * `env:` followed by a list of `- variable: NAME` blocks. A general parser
 * would be a dependency to read eight lines of structure.
 */
function parseEnvEntries(yaml) {
  const entries = [];
  let current = null;
  let inEnv = false;

  for (const raw of yaml.split('\n')) {
    if (/^env:\s*$/.test(raw)) { inEnv = true; continue; }
    if (!inEnv) continue;
    if (/^\S/.test(raw)) break; // a new top-level key ends the env block

    const variable = raw.match(/^\s*-\s*variable:\s*(\S+)/);
    if (variable) {
      if (current) entries.push(current);
      current = { variable: variable[1], value: '', secret: false };
      continue;
    }
    if (!current) continue;

    const value = raw.match(/^\s+value:\s*(.*)$/);
    if (value) {
      current.value = value[1].trim().replace(/^["']|["']$/g, '');
      continue;
    }
    if (/^\s+secret:\s*\S+/.test(raw)) current.secret = true;
  }
  if (current) entries.push(current);
  return entries;
}

function render(entries) {
  const boot = entries.filter((entry) => REQUIRED_TO_BOOT.has(entry.variable));
  const optional = entries.filter((entry) => !REQUIRED_TO_BOOT.has(entry.variable));

  const lines = [
    '# Local environment for Markaestro.',
    '#',
    '# Generated from apphosting.yaml by `npm run env:example`. Do not edit by',
    '# hand: a variable added to the deployment appears here on the next run,',
    '# and CI fails when this file and apphosting.yaml disagree.',
    '#',
    '# Copy to .env.local and fill in what you need. Values shown are the',
    '# production defaults for public configuration; every secret is blank,',
    '# because secrets live in Secret Manager and never in the repository.',
    '#',
    '# You do NOT need every variable. The first section is what the app needs',
    '# to boot; everything after it unlocks one integration at a time, so you',
    '# can work on the composer without registering six OAuth apps.',
    '',
    '# ── Required to boot ─────────────────────────────────────────────────────',
    '',
  ];

  const emit = (entry) => {
    const note = NOTES[entry.variable];
    if (note) lines.push(`# ${note}`);
    lines.push(`${entry.variable}=${entry.secret ? '' : entry.value}`);
  };

  for (const entry of boot) emit(entry);

  lines.push('', '# ── Optional: integrations, billing, and tuning ──────────────────────────', '');
  for (const entry of optional) emit(entry);

  return `${lines.join('\n')}\n`;
}

const entries = [...parseEnvEntries(readFileSync(SOURCE, 'utf8')), ...EXTRA];
const serialized = render(entries);

if (!check) {
  writeFileSync(OUTPUT, serialized);
  console.log(`Wrote .env.local.example (${entries.length} variables)`);
  process.exit(0);
}

let committed;
try {
  committed = readFileSync(OUTPUT, 'utf8');
} catch {
  console.error('.env.local.example is missing. Run `npm run env:example`.');
  process.exit(1);
}

if (committed !== serialized) {
  console.error(
    '.env.local.example is out of date with apphosting.yaml.\n' +
    'Run `npm run env:example` and commit the result.',
  );
  process.exit(1);
}

console.log('env:example check passed');
