import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `firestore.rules` denies every path, and that is only sound while no
 * browser code touches Firestore directly: the Admin SDK in API routes
 * bypasses rules, the Web SDK does not, so the first component that imports
 * `collection`/`doc` from 'firebase/firestore' ships a feature that fails in
 * production against deny-all rules, or worse, prompts someone to loosen
 * them without the review the rules file demands.
 *
 * This test is the tripwire: client code may use Firebase Auth and nothing
 * else. If it fails, the fix is an API route, not a rules change.
 */

const ROOT = join(process.cwd(), 'src');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      yield* walk(path);
    } else if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      yield path;
    }
  }
}

describe('firestore client isolation', () => {
  it('keeps the browser away from Firestore: rules are deny-all and must stay sound', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes("from 'firebase/firestore'") && !source.includes('from "firebase/firestore"')) {
        continue;
      }
      // The client bootstrap may initialize the handle (it is exported for
      // historical reasons); importing query primitives anywhere is the line.
      if (file.endsWith('firebase-client.ts')) continue;
      offenders.push(file.slice(ROOT.length + 1));
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the rules file deny-by-default', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    expect(rules).toContain('allow read, write: if false');
    // No allow-true anywhere: an allowlisted collection would add a narrower
    // match block, and this assertion forces that to be a deliberate edit
    // here as well as there.
    expect(rules).not.toMatch(/allow[^;]*if\s+true/);
    expect(rules).not.toMatch(/allow[^;]*request\.auth/);
  });
});
