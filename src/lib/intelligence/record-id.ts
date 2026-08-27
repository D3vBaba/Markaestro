import { createHash } from 'node:crypto';

export function intelligenceRecordId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('base64url').slice(0, 40);
}
