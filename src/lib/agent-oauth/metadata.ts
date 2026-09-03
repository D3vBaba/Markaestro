import { publicApiScopes, type PublicApiScope } from '@/lib/public-api/scopes';

/**
 * Discovery documents for the agent OAuth flow.
 *
 * An MCP client that receives a 401 from the MCP endpoint reads the
 * `WWW-Authenticate` challenge, fetches the protected-resource metadata it
 * names (RFC 9728), follows `authorization_servers` to the authorization
 * server metadata (RFC 8414), registers itself (RFC 7591), and opens the
 * browser on `authorization_endpoint`. None of this needs a pre-shared key.
 */

export const MCP_RESOURCE_PATH = '/api/public/v1/mcp';
export const AUTHORIZE_PAGE_PATH = '/oauth/authorize';
export const TOKEN_ENDPOINT_PATH = '/api/public/v1/oauth/token';
export const REGISTRATION_ENDPOINT_PATH = '/api/public/v1/oauth/register';
export const REVOCATION_ENDPOINT_PATH = '/api/public/v1/oauth/revoke';
export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';
export const AUTHORIZATION_SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server';

/**
 * The scopes a connected agent receives when it does not ask for a specific
 * set. Everything an agent needs to plan, upload, schedule, and report back;
 * not webhook management, which is workspace plumbing rather than agent work.
 */
export const DEFAULT_AGENT_SCOPES: readonly PublicApiScope[] = [
  'products.read',
  'media.write',
  'posts.read',
  'posts.write',
  'posts.publish',
  'job_runs.read',
];

/**
 * Turn a space-separated OAuth `scope` string into the app's scope list.
 * Unknown scopes are an error rather than silently dropped, so an agent that
 * asks for something this server does not offer finds out at consent time.
 */
export function parseScopeParam(scope: string | null | undefined): { scopes: PublicApiScope[]; unknown: string[] } {
  const requested = (scope ?? '').split(/\s+/).map((s) => s.trim()).filter(Boolean);
  if (requested.length === 0) return { scopes: [...DEFAULT_AGENT_SCOPES], unknown: [] };
  const known = new Set<string>(publicApiScopes);
  const unknown = requested.filter((s) => !known.has(s));
  const scopes = Array.from(new Set(requested.filter((s) => known.has(s)))) as PublicApiScope[];
  return { scopes, unknown };
}

/** Origin of the request as the client saw it, honouring a proxy in front. */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(/:$/, '');
  const host =
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    req.headers.get('host') ||
    url.host;
  return `${proto}://${host}`;
}

/**
 * Where the consent page lives. With the marketing/app domain split, the
 * page is served from the app host while the API stays on whichever host
 * was asked; without the split, both are the same origin.
 */
export type EnvLike = Record<string, string | undefined>;

export function authorizePageOrigin(apiOrigin: string, env: EnvLike = process.env): string {
  const split = env.APP_DOMAIN_SPLIT_ENABLED === '1' || env.APP_DOMAIN_SPLIT_ENABLED === 'true';
  const appOrigin = env.NEXT_PUBLIC_APP_ORIGIN?.replace(/\/$/, '');
  return split && appOrigin ? appOrigin : apiOrigin;
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${MCP_RESOURCE_PATH}`,
    authorization_servers: [origin],
    scopes_supported: [...publicApiScopes],
    bearer_methods_supported: ['header'],
    resource_name: 'Markaestro MCP',
    resource_documentation: 'https://markaestro.com/developers/agents',
  };
}

export function authorizationServerMetadata(origin: string, env: EnvLike = process.env) {
  return {
    issuer: origin,
    authorization_endpoint: `${authorizePageOrigin(origin, env)}${AUTHORIZE_PAGE_PATH}`,
    token_endpoint: `${origin}${TOKEN_ENDPOINT_PATH}`,
    registration_endpoint: `${origin}${REGISTRATION_ENDPOINT_PATH}`,
    revocation_endpoint: `${origin}${REVOCATION_ENDPOINT_PATH}`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [...publicApiScopes],
    service_documentation: 'https://markaestro.com/developers/agents',
  };
}

/**
 * The `WWW-Authenticate` value the MCP endpoint sends with a 401. The
 * path-suffixed metadata URL is the one the MCP specification tells clients
 * to derive for a resource that lives under a path; the root document is
 * served too for clients that only know the older form.
 */
export function bearerChallenge(origin: string): string {
  const metadata = `${origin}${PROTECTED_RESOURCE_METADATA_PATH}${MCP_RESOURCE_PATH}`;
  return `Bearer realm="markaestro", resource_metadata="${metadata}"`;
}
