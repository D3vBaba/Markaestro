/**
 * Module resolution for scripts that import the app's TypeScript directly.
 *
 * Node strips types natively, so no build step is needed, but it resolves
 * modules the way Node does rather than the way TypeScript does. Three gaps:
 *
 *   - the `@/*` path alias that tsconfig defines and every module in `src/`
 *     uses;
 *   - extensionless relative imports (`./scopes`), which TypeScript resolves
 *     to `./scopes.ts` and Node does not resolve at all;
 *   - `.ts` files in a package with no `"type": "module"`, which Node tries as
 *     CommonJS first and reparses, warning each time.
 *
 * Closing all three is the difference between a generator that reads the real
 * Zod schemas and one that maintains a second copy of them.
 *
 * Register with:  node --import ./scripts/lib/ts-alias-loader.mjs script.mjs
 */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../', import.meta.url);
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function firstExisting(baseHref) {
  for (const extension of EXTENSIONS) {
    const candidate = baseHref + extension;
    if (candidate.startsWith('file:') && existsSync(fileURLToPath(candidate))) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null;
    if (specifier.startsWith('@/')) {
      base = new URL(`src/${specifier.slice(2)}`, ROOT).href;
    } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
      base = new URL(specifier, context.parentURL ?? ROOT).href;
    }

    const resolved = base ? firstExisting(base) : null;
    if (!resolved) return nextResolve(specifier, context);
    return { url: resolved, format: resolved.endsWith('.ts') || resolved.endsWith('.tsx') ? 'module-typescript' : undefined, shortCircuit: true };
  },
});
