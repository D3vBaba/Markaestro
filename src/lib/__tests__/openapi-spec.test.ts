import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenApiDocument } from '@/lib/public-api/openapi';
import { listErrorCodes } from '@/lib/error-codes';
import { publicPostResponseSchema } from '@/lib/public-api/response-schemas';
import { serializePublicPost } from '@/lib/public-api/posts';

/**
 * There was no OpenAPI document anywhere in the repo, and `docs/PUBLIC_API.md`
 * was a hand-maintained markdown table. That is how `PublicPostResponse` could
 * claim a `publishedAt` the serializer never returned.
 *
 * Generating the spec from the Zod schemas removes one class of drift. These
 * tests close the other: that the schemas themselves still describe what the
 * serializers produce.
 */

const doc = buildOpenApiDocument() as {
  openapi: string;
  info: { description: string };
  paths: Record<string, Record<string, { operationId?: string; responses: Record<string, unknown> }>>;
  components: { schemas: Record<string, unknown> };
};

describe('the generated OpenAPI document', () => {
  it('is OpenAPI 3.1 with servers, security, and paths', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths).length).toBeGreaterThan(5);
    expect(doc.components.schemas.Post).toBeTruthy();
    expect(doc.components.schemas.Error).toBeTruthy();
  });

  it('gives every operation a unique operationId, which is what SDK generators name methods from', () => {
    const ids = Object.values(doc.paths)
      .flatMap((methods) => Object.values(methods))
      .map((operation) => operation.operationId)
      .filter(Boolean);
    expect(ids.length).toBeGreaterThan(5);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('documents the error responses every endpoint can return', () => {
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        expect(Object.keys(operation.responses), `${method.toUpperCase()} ${path}`)
          .toEqual(expect.arrayContaining(['401', '429']));
      }
    }
  });

  it('carries the whole error catalogue, so a client can enumerate what it might receive', () => {
    // The reason the catalogue exists: an integrator could not find out what
    // codes the API returns without reading the source.
    for (const record of listErrorCodes().slice(0, 40)) {
      expect(doc.info.description).toContain(record.code);
    }
  });

  it('describes the request body from the schema the route actually validates against', () => {
    const createPost = doc.components.schemas.CreatePost as { properties: Record<string, unknown> };
    expect(Object.keys(createPost.properties)).toEqual(
      expect.arrayContaining(['channel', 'targets', 'caption', 'mediaAssetIds', 'scheduledAt']),
    );
  });

  it('matches the committed spec file', () => {
    // The same assertion `npm run openapi:check` makes in CI, repeated here so
    // a developer who forgets to regenerate finds out from the test suite too.
    const committed = readFileSync(join(process.cwd(), 'openapi', 'markaestro-v1.json'), 'utf8');
    expect(committed).toBe(`${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
  });
});

describe('response schemas describe what the serializers return', () => {
  it('accepts a fully populated post', () => {
    const serialized = serializePublicPost({
      id: 'post_1',
      channel: 'instagram',
      status: 'published',
      content: 'hello',
      productId: 'brand_1',
      destinationId: 'dest_1',
      destinationProvider: 'instagram',
      deliveryMode: 'direct_publish',
      mediaAssetIds: ['asset_1'],
      mediaUrls: ['https://example.com/a.jpg'],
      scheduledAt: '2026-08-29T10:00:00.000Z',
      publishedAt: '2026-08-29T10:00:04.000Z',
      externalId: 'ig_1',
      externalUrl: 'https://instagram.com/p/1',
      createdAt: '2026-08-29T09:00:00.000Z',
      updatedAt: '2026-08-29T10:00:04.000Z',
    });
    expect(() => publicPostResponseSchema.parse(serialized)).not.toThrow();
  });

  it('accepts a bare draft, where most fields are empty rather than absent', () => {
    const serialized = serializePublicPost({
      id: 'post_2',
      channel: 'linkedin',
      status: 'draft',
      createdAt: '2026-08-29T09:00:00.000Z',
      updatedAt: '2026-08-29T09:00:00.000Z',
    });
    expect(() => publicPostResponseSchema.parse(serialized)).not.toThrow();
    expect(serialized.publishedAt).toBeNull();
  });

  it('would fail if the serializer dropped a documented field', () => {
    // This is the assertion that would have caught the original FP-06 drift.
    const serialized = serializePublicPost({
      id: 'post_3',
      channel: 'linkedin',
      status: 'draft',
      createdAt: '2026-08-29T09:00:00.000Z',
      updatedAt: '2026-08-29T09:00:00.000Z',
    }) as Record<string, unknown>;
    delete serialized.publishedAt;
    expect(() => publicPostResponseSchema.parse(serialized)).toThrow();
  });
});

describe('the marketing developers page cannot drift from the real API', () => {
  it('lists only endpoints that actually exist as route files', () => {
    // The page's endpoint list is translated prose, so it cannot be generated
    // from the spec the way docs/PUBLIC_API.md's reference is. This is the
    // guard instead: every path it advertises must resolve to a route file,
    // which is exactly the drift (documented-but-absent endpoints) that
    // FP-09/DE-04 found the last time nothing checked.
    const en = JSON.parse(
      readFileSync(join(process.cwd(), 'src', 'messages', 'en', 'developersApi.json'), 'utf8'),
    ) as {
      endpointGroups: Array<{ endpoints: Array<{ path?: string }> }>;
      connectApi: { endpoints: Array<{ path?: string }> };
    };

    const advertised = [
      ...en.endpointGroups.flatMap((group) => group.endpoints),
      ...en.connectApi.endpoints,
    ]
      .map((endpoint) => endpoint.path ?? '')
      // Storage upload URLs are placeholders, not routes.
      .filter((path) => path.startsWith('/api/'));

    const missing = advertised.filter((path) => {
      const routeDir = path
        .replace(/^\//, '')
        .replace(/:(\w+)/g, (_, name: string) => `[${name}]`);
      const routeFile = join(process.cwd(), 'src', 'app', routeDir, 'route.ts');
      try {
        readFileSync(routeFile, 'utf8');
        return false;
      } catch {
        return true;
      }
    });

    expect(missing).toEqual([]);
  });
});
