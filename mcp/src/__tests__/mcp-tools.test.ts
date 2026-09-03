import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MarkaestroApiError, MarkaestroClient, contentTypeFor } from '../client';
import { createTools, describeError } from '../tools';
import { buildServer, clientFromEnv, serverOptionsFromEnv } from '../server';

type Call = { url: string; init: RequestInit };

function fakeFetch(routes: Array<{ match: (call: Call) => boolean; status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    const route = routes.find((candidate) => candidate.match(call));
    if (!route) return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 });
    return new Response(route.body === undefined ? '' : JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...(route.headers ?? {}) },
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const KEY = 'mk_test_ws.cli.secret';

describe('MarkaestroClient', () => {
  it('refuses anything that is not a Markaestro key', () => {
    expect(() => new MarkaestroClient({ apiKey: 'sk-abc' })).toThrow(/mk_live_ or mk_test_/);
    expect(() => clientFromEnv({})).toThrow(/MARKAESTRO_API_KEY/);
  });

  it('sends the bearer key, an idempotency key on mutations, and none on reads', async () => {
    const { impl, calls } = fakeFetch([{ match: () => true, body: { ok: true } }]);
    const client = new MarkaestroClient({ apiKey: KEY, baseUrl: 'https://x.test/', fetch: impl });
    await client.request('GET', '/api/public/v1/posts', undefined, { limit: 5, cursor: undefined });
    await client.request('POST', '/api/public/v1/posts', { caption: 'hi' });
    const read = calls[0]!.init.headers as Record<string, string>;
    const write = calls[1]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe('https://x.test/api/public/v1/posts?limit=5');
    expect(read.Authorization).toBe(`Bearer ${KEY}`);
    expect(read['Idempotency-Key']).toBeUndefined();
    expect(write['Idempotency-Key']).toMatch(/^mk_idem_[0-9a-f]{32}$/);
    expect(write['Content-Type']).toBe('application/json');
  });

  it('retries 429 with Retry-After and reuses the same idempotency key', async () => {
    let attempt = 0;
    const { impl, calls } = fakeFetch([
      { match: () => attempt++ === 0, status: 429, body: { error: 'RATE_LIMITED' }, headers: { 'Retry-After': '3' } },
      { match: () => true, body: { post: { id: 'p1' } } },
    ]);
    const sleep = vi.fn(async () => {});
    const client = new MarkaestroClient({ apiKey: KEY, fetch: impl, sleep });
    const result = await client.request<{ post: { id: string } }>('POST', '/api/public/v1/posts', {});
    expect(result.post.id).toBe('p1');
    expect(sleep).toHaveBeenCalledWith(3000);
    const keys = calls.map((call) => (call.init.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]);
  });

  it('throws a typed error carrying code, issues, and Retry-After', async () => {
    const { impl } = fakeFetch([{
      match: () => true,
      status: 400,
      body: { error: 'VALIDATION_ERROR', message: 'Bad targets', issues: [{ channel: 'instagram', code: 'VALIDATION_INSTAGRAM_REQUIRES_MEDIA', message: 'Instagram needs media' }] },
    }]);
    const client = new MarkaestroClient({ apiKey: KEY, fetch: impl, maxRetries: 0 });
    const error = await client.request('POST', '/api/public/v1/posts', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MarkaestroApiError);
    const text = describeError(error);
    expect(text).toContain('VALIDATION_ERROR (HTTP 400)');
    expect(text).toContain('instagram: VALIDATION_INSTAGRAM_REQUIRES_MEDIA Instagram needs media');
  });

  it('runs the three-step upload without sending the API key to storage', async () => {
    const { impl, calls } = fakeFetch([
      { match: (c) => c.url.endsWith('/media/upload-sessions') && c.init.method === 'POST', body: { uploadSession: { id: 'ast_1', uploadUrl: 'https://storage.test/signed', uploadHeaders: { 'x-goog-meta': '1' } } } },
      { match: (c) => c.url === 'https://storage.test/signed', body: { ok: true } },
      { match: (c) => c.url.endsWith('/upload-sessions/ast_1/finalize'), body: { asset: { id: 'ast_1', type: 'image' } } },
    ]);
    const client = new MarkaestroClient({ apiKey: KEY, fetch: impl });
    const asset = await client.uploadMedia({ source: 'data:image/png;base64,iVBORw0KGgo=', fileName: 'dot.png' });
    expect(asset).toEqual({ id: 'ast_1', type: 'image' });
    const put = calls.find((call) => call.url === 'https://storage.test/signed')!;
    const headers = put.init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['Content-Type']).toBe('image/png');
    expect(headers['x-goog-meta']).toBe('1');
    const session = JSON.parse(String(calls[0]!.init.body)) as { fileName: string; contentType: string; sizeBytes: number };
    expect(session).toEqual({ fileName: 'dot.png', contentType: 'image/png', sizeBytes: 8 });
  });

  it('infers content types from extensions and refuses unknown ones', async () => {
    expect(contentTypeFor('a.JPG')).toBe('image/jpeg');
    expect(contentTypeFor('clip.mov')).toBe('video/quicktime');
    expect(contentTypeFor('notes.txt')).toBeNull();
    const client = new MarkaestroClient({ apiKey: KEY, fetch: fakeFetch([]).impl });
    await expect(client.uploadMedia({ source: 'data:text/plain,hello', fileName: 'x.bin', contentType: undefined }))
      .resolves.toBeDefined().catch(() => undefined);
  });
});

describe('tool handlers', () => {
  it('create_post forwards only the fields given and explains draft versus scheduled', async () => {
    const { impl, calls } = fakeFetch([{ match: () => true, body: { post: { id: 'p1', status: 'draft' } } }]);
    const client = new MarkaestroClient({ apiKey: KEY, fetch: impl });
    const tool = createTools(client).find((item) => item.name === 'create_post')!;
    const result = await tool.handler({ caption: 'Hello', channel: 'threads', mediaAssetIds: undefined }) as { note: string };
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ caption: 'Hello', channel: 'threads' });
    expect(result.note).toMatch(/draft/i);
  });

  it('create_posts forwards a batch and strips undefined fields', async () => {
    const { impl, calls } = fakeFetch([{ match: () => true, body: { results: [], created: 0, total: 2 } }]);
    const client = new MarkaestroClient({ apiKey: KEY, fetch: impl });
    const tool = createTools(client).find((item) => item.name === 'create_posts')!;
    await tool.handler({ posts: [{ caption: 'a', channel: 'threads', scheduledAt: undefined }, { caption: 'b', targets: [{ channel: 'linkedin' }] }] });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ posts: [{ caption: 'a', channel: 'threads' }, { caption: 'b', targets: [{ channel: 'linkedin' }] }] });
  });

  it('bulk_posts only sends the field the action needs', async () => {
    const { impl, calls } = fakeFetch([{ match: () => true, body: { succeeded: ['a'], failed: [] } }]);
    const client = new MarkaestroClient({ apiKey: KEY, fetch: impl });
    const tool = createTools(client).find((item) => item.name === 'bulk_posts')!;
    await tool.handler({ ids: ['a'], action: 'delete', scheduledAt: '2026-01-01T00:00:00Z', status: 'draft' });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ ids: ['a'], action: 'delete' });
  });

  it('marks reads as read-only and deletes as destructive', () => {
    const tools = createTools(new MarkaestroClient({ apiKey: KEY, fetch: fakeFetch([]).impl }));
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    expect(byName.list_posts!.readOnly).toBe(true);
    expect(byName.delete_post!.destructive).toBe(true);
    expect(byName.create_post!.readOnly).toBe(false);
    expect(tools.map((tool) => tool.name)).toEqual([
      'list_products', 'list_destinations', 'list_posts', 'get_post', 'create_post', 'publish_post', 'delete_post',
      'bulk_posts', 'create_posts', 'preview_evergreen_queue', 'list_evergreen_queues', 'get_evergreen_queue',
      'create_evergreen_queue', 'update_evergreen_queue', 'activate_evergreen_queue', 'pause_evergreen_queue',
      'resume_evergreen_queue', 'archive_evergreen_queue', 'list_evergreen_runs', 'get_evergreen_analytics',
      'upload_media', 'list_media', 'get_media', 'get_job_run', 'list_job_runs',
      'list_webhook_endpoints', 'create_webhook_endpoint', 'get_channel_rules',
    ]);
  });
});

describe('read-only mode', () => {
  it('reads the flag from the environment and drops every mutating tool', async () => {
    expect(serverOptionsFromEnv({ MARKAESTRO_READ_ONLY: '1' }).readOnly).toBe(true);
    expect(serverOptionsFromEnv({}).readOnly).toBe(false);
    const server = buildServer(new MarkaestroClient({ apiKey: KEY, fetch: fakeFetch([]).impl }), { readOnly: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    expect(tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
    expect(tools.map((tool) => tool.name)).not.toContain('create_post');
    expect(tools.length).toBe(15);
  });
});

describe('MCP server over an in-memory transport', () => {
  async function connect() {
    const { impl, calls } = fakeFetch([
      { match: (c) => c.url.endsWith('/products'), body: { products: [{ id: 'prod_1', name: 'Brand' }], count: 1 } },
      { match: (c) => c.url.includes('/posts/missing'), status: 404, body: { error: 'NOT_FOUND', message: 'No such post' } },
    ]);
    const server = buildServer(new MarkaestroClient({ apiKey: KEY, fetch: impl, maxRetries: 0 }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientTransport);
    return { client, calls };
  }

  it('lists every tool with annotations and serves the channel-rules resource', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(28);
    const del = tools.find((tool) => tool.name === 'delete_post')!;
    expect(del.annotations?.destructiveHint).toBe(true);
    expect(del.annotations?.readOnlyHint).toBe(false);
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual(['markaestro://channel-rules']);
    const read = await client.readResource({ uri: 'markaestro://channel-rules' });
    expect(String((read.contents[0] as { text: string }).text)).toContain('instagram');
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual(['schedule_post']);
  });

  it('returns tool results as JSON text and API failures as isError content', async () => {
    const { client } = await connect();
    const ok = await client.callTool({ name: 'list_products', arguments: {} });
    expect(ok.isError).toBeFalsy();
    expect(JSON.parse((ok.content as Array<{ text: string }>)[0]!.text).products[0].id).toBe('prod_1');
    const failed = await client.callTool({ name: 'get_post', arguments: { postId: 'missing' } });
    expect(failed.isError).toBe(true);
    expect((failed.content as Array<{ text: string }>)[0]!.text).toContain('NOT_FOUND (HTTP 404)');
    const invalid = await client.callTool({ name: 'list_posts', arguments: { limit: 500 } });
    expect(invalid.isError).toBe(true);
  });
});
