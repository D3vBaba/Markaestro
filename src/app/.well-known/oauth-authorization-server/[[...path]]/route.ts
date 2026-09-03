/**
 * Authorization server metadata (RFC 8414). Tells an MCP client where to
 * register, where to send the user, and where to exchange the code. Served
 * at the root well-known path and at the path-suffixed variant some
 * clients derive from the resource URL.
 */
import { NextResponse } from 'next/server';
import { authorizationServerMetadata, requestOrigin } from '@/lib/agent-oauth/metadata';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const res = NextResponse.json(authorizationServerMetadata(requestOrigin(req)));
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
