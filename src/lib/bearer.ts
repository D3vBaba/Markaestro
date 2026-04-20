/**
 * Parse a `Bearer <token>` Authorization header safely.
 *
 * `.replace('Bearer ', '')` is fragile — it strips the first occurrence of
 * the substring "Bearer " anywhere in the header, and quietly succeeds on
 * values like `Basic ...` (returning them unchanged, which can then be
 * passed to verifyIdToken and fail with a confusing error). This helper
 * explicitly checks the scheme and returns null for any other shape.
 */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token || null;
}

export function getBearerFromRequest(req: Request): string | null {
  return parseBearerToken(req.headers.get('authorization'));
}
