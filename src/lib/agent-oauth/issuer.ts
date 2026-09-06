/**
 * RFC 9207 issuer for authorization responses that are built in the browser
 * (the consent page's Cancel, and the bounce for a resource we do not serve).
 *
 * The rule mirrors the server's: when the client sent a `resource`, its origin
 * is the API host the client discovered us on and therefore the issuer it
 * recorded, but only if that origin is one of ours. A foreign resource is
 * exactly the case that produces `invalid_target`, and its origin must never
 * be echoed as our issuer; the page's own origin is used instead.
 */
export function browserIssuerFor(
  resource: string | null | undefined,
  pageOrigin: string,
  knownOrigins: ReadonlyArray<string | undefined | null>,
): string {
  const own = new Set<string>([pageOrigin, ...knownOrigins.filter((o): o is string => typeof o === 'string' && o.length > 0)].map((o) => o.replace(/\/$/, '')));
  if (resource) {
    try {
      const origin = new URL(resource).origin;
      if (own.has(origin)) return origin;
    } catch {
      // Not a URL; the server refuses the request and the page falls through.
    }
  }
  return pageOrigin;
}
