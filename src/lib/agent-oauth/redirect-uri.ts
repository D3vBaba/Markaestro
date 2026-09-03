/**
 * Which redirect URIs a dynamically registered client may use.
 *
 * MCP clients are native apps: Claude Code listens on a loopback port,
 * desktop editors use a custom scheme, and hosted agents (claude.ai,
 * ChatGPT) use an https callback. RFC 8252 §7 covers all three, and the one
 * thing it forbids is plain http to a non-loopback host, because the code
 * would travel in the clear.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isAllowedRedirectUri(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
  // Custom scheme (e.g. cursor://, vscode://). Anything but javascript/data.
  return !/^(javascript|data|file|blob|about):$/i.test(url.protocol);
}

/**
 * Exact-match, except that a loopback redirect may use any port (RFC 8252
 * §7.3): the client picks a free port at runtime and cannot know it at
 * registration time.
 */
export function redirectUriMatches(registered: string, presented: string): boolean {
  if (registered === presented) return true;
  let a: URL;
  let b: URL;
  try {
    a = new URL(registered);
    b = new URL(presented);
  } catch {
    return false;
  }
  if (a.protocol !== 'http:' || b.protocol !== 'http:') return false;
  if (!LOOPBACK_HOSTS.has(a.hostname) || !LOOPBACK_HOSTS.has(b.hostname)) return false;
  return a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
}
