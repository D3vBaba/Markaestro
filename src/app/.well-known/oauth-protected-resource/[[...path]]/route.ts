/**
 * Protected resource metadata (RFC 9728) for the hosted MCP endpoint.
 *
 * Served at both `/.well-known/oauth-protected-resource` and the
 * path-suffixed `/.well-known/oauth-protected-resource/api/public/v1/mcp`
 * that the MCP specification tells clients to try first. Public and
 * cacheable: it names endpoints, nothing more.
 */
import { NextResponse } from 'next/server';
import { protectedResourceMetadata, requestOrigin } from '@/lib/agent-oauth/metadata';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const res = NextResponse.json(protectedResourceMetadata(requestOrigin(req)));
  res.headers.set('Cache-Control', 'public, max-age=3600');
  res.headers.set('Access-Control-Allow-Origin', '*');
  return res;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,MCP-Protocol-Version',
    },
  });
}
