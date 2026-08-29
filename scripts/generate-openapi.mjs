#!/usr/bin/env node
/**
 * Write the OpenAPI description of the public API to `openapi/`.
 *
 * The document is built from the Zod schemas the routes validate against
 * (`src/lib/public-api/openapi.ts`), so it cannot describe a request shape the
 * server does not accept. This script only serializes it and, in `--check`
 * mode, fails when the committed file no longer matches, which is what stops
 * the spec going stale between the change and the release notes.
 *
 * Usage:
 *   node --import ./scripts/lib/ts-alias-loader.mjs scripts/generate-openapi.mjs
 *   node --import ./scripts/lib/ts-alias-loader.mjs scripts/generate-openapi.mjs --check
 *
 * JSON rather than YAML: both are valid OpenAPI, every tool reads JSON, and
 * emitting it needs no serializer of our own to go wrong. A hand-rolled YAML
 * writer is a bug surface in a file whose whole job is to be trustworthy.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenApiDocument } from '@/lib/public-api/openapi';

const OUTPUT = join(process.cwd(), 'openapi', 'markaestro-v1.json');
const check = process.argv.includes('--check');

// Stable key order and a trailing newline so a regenerated file diffs cleanly
// rather than reordering itself between runs.
const serialized = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;

if (!check) {
  writeFileSync(OUTPUT, serialized);
  const paths = Object.keys(buildOpenApiDocument().paths).length;
  console.log(`Wrote ${OUTPUT} (${paths} paths, ${serialized.length} bytes)`);
  process.exit(0);
}

let committed;
try {
  committed = readFileSync(OUTPUT, 'utf8');
} catch {
  console.error('openapi/markaestro-v1.json is missing. Run `npm run openapi:generate`.');
  process.exit(1);
}

if (committed !== serialized) {
  console.error(
    'openapi/markaestro-v1.json is out of date.\n' +
    'The API schemas changed without the spec being regenerated.\n' +
    'Run `npm run openapi:generate` and commit the result.',
  );
  process.exit(1);
}

console.log('openapi:check passed');
