import { describe, expect, it } from 'vitest';
import { hashToken, isValidCodeChallenge, isValidCodeVerifier, randomToken, s256Challenge, verifyPkce } from '../pkce';
import { isAllowedRedirectUri, redirectUriMatches } from '../redirect-uri';
import {
  InvalidResource,
  authorizationServerMetadata,
  authorizePageOrigin,
  bearerChallenge,
  canonicalResource,
  normalizeResource,
  parseScopeParam,
  protectedResourceMetadata,
  requestOrigin,
} from '../metadata';
import { browserIssuerFor } from '../issuer';

describe('PKCE', () => {
  it('accepts a verifier that hashes to the challenge and rejects the rest', () => {
    const verifier = randomToken(48);
    expect(isValidCodeVerifier(verifier)).toBe(true);
    const challenge = s256Challenge(verifier);
    expect(isValidCodeChallenge(challenge)).toBe(true);
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(randomToken(48), challenge)).toBe(false);
    expect(verifyPkce(undefined, challenge)).toBe(false);
  });

  it('rejects verifiers outside the RFC 7636 length and alphabet', () => {
    expect(isValidCodeVerifier('short')).toBe(false);
    expect(isValidCodeVerifier('a'.repeat(129))).toBe(false);
    expect(isValidCodeVerifier('a'.repeat(43))).toBe(true);
    expect(isValidCodeVerifier(`${'a'.repeat(42)}!`)).toBe(false);
  });

  it('rejects a challenge that is not a base64url SHA-256', () => {
    expect(isValidCodeChallenge('plain-text-challenge')).toBe(false);
    expect(isValidCodeChallenge(`${'a'.repeat(43)}=`)).toBe(false);
  });

  it('hashes tokens deterministically without exposing them', () => {
    const token = randomToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toHaveLength(64);
  });
});

describe('redirect URIs', () => {
  it('allows https, loopback http, and custom app schemes', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:53421/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:8080/cb')).toBe(true);
    expect(isAllowedRedirectUri('cursor://anysphere.cursor-mcp/oauth/callback')).toBe(true);
  });

  it('refuses plain http to a real host, fragments, and script schemes', () => {
    expect(isAllowedRedirectUri('http://example.com/callback')).toBe(false);
    expect(isAllowedRedirectUri('https://example.com/callback#frag')).toBe(false);
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
    expect(isAllowedRedirectUri('not a url')).toBe(false);
    expect(isAllowedRedirectUri(42)).toBe(false);
  });

  it('matches exactly, except that loopback may change port', () => {
    expect(redirectUriMatches('https://claude.ai/cb', 'https://claude.ai/cb')).toBe(true);
    expect(redirectUriMatches('https://claude.ai/cb', 'https://claude.ai/cb2')).toBe(false);
    expect(redirectUriMatches('http://localhost:1000/cb', 'http://localhost:2000/cb')).toBe(true);
    expect(redirectUriMatches('http://localhost:1000/cb', 'http://localhost:2000/other')).toBe(false);
    expect(redirectUriMatches('http://localhost:1000/cb', 'http://127.0.0.1:1000/cb')).toBe(false);
    expect(redirectUriMatches('https://a.example/cb', 'https://a.example:444/cb')).toBe(false);
  });
});

describe('discovery metadata', () => {
  it('derives the origin from forwarded headers when a proxy is in front', () => {
    const req = new Request('http://internal:8080/api/public/v1/mcp', {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'markaestro.com' },
    });
    expect(requestOrigin(req)).toBe('https://markaestro.com');
    expect(requestOrigin(new Request('http://localhost:3000/x'))).toBe('http://localhost:3000');
  });

  it('points the challenge at the path-suffixed protected-resource document', () => {
    expect(bearerChallenge('https://markaestro.com')).toBe(
      'Bearer realm="markaestro", resource_metadata="https://markaestro.com/.well-known/oauth-protected-resource/api/public/v1/mcp"',
    );
  });

  it('names the MCP endpoint as the resource and the origin as its authorization server', () => {
    const prm = protectedResourceMetadata('https://markaestro.com');
    expect(prm.resource).toBe('https://markaestro.com/api/public/v1/mcp');
    expect(prm.authorization_servers).toEqual(['https://markaestro.com']);
    expect(prm.scopes_supported).toContain('posts.publish');
  });

  it('advertises PKCE S256, both grants, and public clients', () => {
    const as = authorizationServerMetadata('https://markaestro.com', {});
    expect(as.issuer).toBe('https://markaestro.com');
    expect(as.authorization_endpoint).toBe('https://markaestro.com/oauth/authorize');
    expect(as.token_endpoint).toBe('https://markaestro.com/api/public/v1/oauth/token');
    expect(as.registration_endpoint).toBe('https://markaestro.com/api/public/v1/oauth/register');
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
    expect(as.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    expect(as.token_endpoint_auth_methods_supported).toContain('none');
  });

  it('sends the browser to the app host when the domain split is on', () => {
    const env = {
      APP_DOMAIN_SPLIT_ENABLED: '1',
      NEXT_PUBLIC_APP_ORIGIN: 'https://app.markaestro.com',
    };
    expect(authorizePageOrigin('https://markaestro.com', env)).toBe('https://app.markaestro.com');
    expect(authorizationServerMetadata('https://markaestro.com', env).authorization_endpoint).toBe(
      'https://app.markaestro.com/oauth/authorize',
    );
    // Token and registration stay on the origin that was asked: /api/* is
    // never host-relocated.
    expect(authorizationServerMetadata('https://markaestro.com', env).token_endpoint).toBe(
      'https://markaestro.com/api/public/v1/oauth/token',
    );
    expect(authorizePageOrigin('https://markaestro.com', { APP_DOMAIN_SPLIT_ENABLED: '0' })).toBe(
      'https://markaestro.com',
    );
  });
});

describe('scope parameter', () => {
  it('falls back to the agent default set when nothing is requested', () => {
    const { scopes, unknown } = parseScopeParam(undefined);
    expect(unknown).toEqual([]);
    expect(scopes).toEqual(['products.read', 'media.write', 'posts.read', 'posts.write', 'posts.publish', 'evergreen.read', 'evergreen.write', 'analytics.read', 'job_runs.read']);
    expect(scopes).not.toContain('webhooks.manage');
  });

  it('keeps known scopes, de-duplicates, and reports unknown ones', () => {
    const { scopes, unknown } = parseScopeParam('posts.read posts.read  bogus.scope posts.write');
    expect(scopes).toEqual(['posts.read', 'posts.write']);
    expect(unknown).toEqual(['bogus.scope']);
  });
});

describe('RFC 8707 resource indicators', () => {
  const ORIGIN = 'https://markaestro.com';

  it('names the MCP endpoint as the canonical resource', () => {
    expect(canonicalResource(ORIGIN)).toBe('https://markaestro.com/api/public/v1/mcp');
    expect(canonicalResource(`${ORIGIN}/`)).toBe('https://markaestro.com/api/public/v1/mcp');
    expect(protectedResourceMetadata(ORIGIN).resource).toBe(canonicalResource(ORIGIN));
  });

  it('accepts the exact resource on the request origin and treats absence as fine', () => {
    expect(normalizeResource('https://markaestro.com/api/public/v1/mcp', ORIGIN, {})).toBe(canonicalResource(ORIGIN));
    expect(normalizeResource(undefined, ORIGIN, {})).toBeNull();
    expect(normalizeResource(null, ORIGIN, {})).toBeNull();
    expect(normalizeResource('', ORIGIN, {})).toBeNull();
  });

  it('accepts the resource on the other origins this deployment answers on', () => {
    const env = { NEXT_PUBLIC_APP_ORIGIN: 'https://app.markaestro.com', NEXT_PUBLIC_MARKETING_URL: 'https://markaestro.com/' };
    // The consent page runs on the app host while the client discovered the
    // API on the marketing apex (or the other way round).
    expect(normalizeResource('https://markaestro.com/api/public/v1/mcp', 'https://app.markaestro.com', env)).toBe(
      'https://markaestro.com/api/public/v1/mcp',
    );
    expect(normalizeResource('https://app.markaestro.com/api/public/v1/mcp', 'https://markaestro.com', env)).toBe(
      'https://app.markaestro.com/api/public/v1/mcp',
    );
    // Local development.
    expect(normalizeResource('http://localhost:3000/api/public/v1/mcp', 'http://localhost:3000', {})).toBe(
      'http://localhost:3000/api/public/v1/mcp',
    );
  });

  it('refuses anything that is not this server', () => {
    const bad = [
      'https://evil.example/api/public/v1/mcp', // another host
      'https://markaestro.com/api/public/v1/posts', // another path
      'https://markaestro.com/api/public/v1/mcp/', // trailing slash is a different resource
      'https://markaestro.com/api/public/v1/mcp?x=1', // query
      'https://markaestro.com/api/public/v1/mcp#frag', // fragment
      'http://markaestro.com/api/public/v1/mcp', // plain http to a real host
      'https://user:pw@markaestro.com/api/public/v1/mcp', // credentials
      'not a url',
      'x'.repeat(2049),
    ];
    for (const candidate of bad) {
      expect(() => normalizeResource(candidate, ORIGIN, {}), candidate).toThrow(InvalidResource);
    }
    // Configured origins are exact: a lookalike subdomain is not covered.
    expect(() =>
      normalizeResource('https://app.markaestro.com.evil.example/api/public/v1/mcp', ORIGIN, {
        NEXT_PUBLIC_APP_ORIGIN: 'https://app.markaestro.com',
      }),
    ).toThrow(InvalidResource);
  });

  it('advertises RFC 9207 iss support so stable-redirect clients can verify the issuer', () => {
    const meta = authorizationServerMetadata(ORIGIN, {});
    expect(meta.authorization_response_iss_parameter_supported).toBe(true);
    expect(meta.issuer).toBe(ORIGIN);
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
    expect(meta.registration_endpoint).toBe(`${ORIGIN}/api/public/v1/oauth/register`);
  });
});

describe('RFC 9207 issuer for browser-built error responses', () => {
  const PAGE = 'https://app.markaestro.com';
  const KNOWN = ['https://app.markaestro.com', 'https://markaestro.com/'];

  it('names the resource origin when it is one of ours (the host the client discovered us on)', () => {
    expect(browserIssuerFor('https://markaestro.com/api/public/v1/mcp', PAGE, KNOWN)).toBe('https://markaestro.com');
    expect(browserIssuerFor('https://app.markaestro.com/api/public/v1/mcp', PAGE, KNOWN)).toBe('https://app.markaestro.com');
  });

  it('never echoes a foreign or malformed resource origin', () => {
    expect(browserIssuerFor('https://evil.example/api/public/v1/mcp', PAGE, KNOWN)).toBe(PAGE);
    expect(browserIssuerFor('https://markaestro.com.evil.example/api/public/v1/mcp', PAGE, KNOWN)).toBe(PAGE);
    expect(browserIssuerFor('not a url', PAGE, KNOWN)).toBe(PAGE);
    expect(browserIssuerFor('', PAGE, KNOWN)).toBe(PAGE);
    expect(browserIssuerFor(null, PAGE, [undefined, null])).toBe(PAGE);
  });
});
