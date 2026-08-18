import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
  });
}

describe('user-visible error surfaces', () => {
  it('does not render raw API, exception, or stored publishing messages', () => {
    const files = [
      ...sourceFiles(join(process.cwd(), 'src/app/(app)')),
      ...sourceFiles(join(process.cwd(), 'src/components')),
      ...sourceFiles(join(process.cwd(), 'src/hooks')),
    ];
    const forbidden = [
      /toast\.error\(\s*res\.data\.(?:error|message)/,
      /toast\.error\(\s*(?:err|error)\.message/,
      /\{post\.errorMessage\}/,
      /title=\{[^\n}]*errorMessage/,
    ];

    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return forbidden
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${file.replace(`${process.cwd()}/`, '')}: ${pattern.source}`);
    });

    expect(violations).toEqual([]);
  });
});

