/**
 * The OpenAPI 3.1 description of the public and Connect surfaces.
 *
 * Generated from the Zod schemas the routes actually validate against, not
 * written alongside them. `docs/PUBLIC_API.md` was a hand-maintained markdown
 * table, which is how `PublicPostResponse` drifted from its serializer without
 * anyone noticing, and why an integrator had to read the source to find out
 * what a 400 could contain.
 *
 * `scripts/generate-openapi.mjs` writes this to `openapi/markaestro-v1.json`
 * and CI fails on a diff, so the committed spec cannot go stale.
 */

import { z } from 'zod';
import {
  createPublicMediaUploadSessionSchema,
  createPublicPostSchema,
  createPublicPostsBatchSchema,
  listPublicPostsSchema,
  registerWebhookEndpointSchema,
} from './schemas';
import { bulkPostOperationSchema } from '@/lib/social/bulk-post-schema';
import {
  publicBulkPostResponseSchema,
  publicErrorResponseSchema,
  publicJobRunListResponseSchema,
  publicJobRunResponseSchema,
  publicMediaAssetResponseSchema,
  publicMediaListResponseSchema,
  publicPostListResponseSchema,
  publicPostResponseSchema,
} from './response-schemas';
import { listErrorCodes } from '@/lib/error-codes';
import {
  API_VERSIONS,
  API_VERSION_HEADER,
  API_VERSION_RESPONSE_HEADER,
  CURRENT_API_VERSION,
  VERSION_COMPATIBILITY_POLICY,
} from './version';
import { publicApiScopes } from './scopes';

type JsonObject = Record<string, unknown>;

/**
 * Zod 4 emits JSON Schema natively, which is already how `ai-gateway.ts`
 * describes response shapes to Vertex. `io: 'input'` matters for request
 * bodies: a schema with `.default()` describes an optional field on the way in
 * and a required one on the way out, and documenting the output shape as the
 * request would tell clients to send fields they do not have to.
 */
function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonObject {
  return z.toJSONSchema(schema, { io, target: 'draft-2020-12', unrepresentable: 'any' }) as JsonObject;
}

function errorResponse(description: string): JsonObject {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  };
}

function okResponse(description: string, ref: string): JsonObject {
  return {
    description,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } },
  };
}

const COMMON_ERRORS = {
  '400': errorResponse('The request was rejected. `error` names the code; see the error catalogue.'),
  '401': errorResponse('The API key is missing, malformed, expired, or revoked.'),
  '403': errorResponse('The key lacks the scope this endpoint needs, or names a brand it is not bound to.'),
  '429': errorResponse('Rate limited. `Retry-After` says how long to wait.'),
};

function cursorParams(): JsonObject[] {
  return [
    {
      name: 'limit',
      in: 'query',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      description: 'How many records to return.',
    },
    {
      name: 'cursor',
      in: 'query',
      required: false,
      schema: { type: 'string' },
      description: 'The `nextCursor` from the previous page. Omit for the first page.',
    },
  ];
}

const VERSION_HEADER_PARAM: JsonObject = {
  name: API_VERSION_RESPONSE_HEADER,
  in: 'header',
  required: false,
  schema: { type: 'string', enum: API_VERSIONS.map((entry) => entry.version) },
  description:
    'Run this request under a specific dated version. Omit to use the version current when the key was created. Every response names the version it ran under in the same header.',
};

/**
 * The error catalogue as documentation.
 *
 * Rendered as a table in the description rather than as a schema enum: a
 * client branches on the string, and an enum of 160 values in the spec makes
 * generated clients unpleasant without telling anyone anything the table does
 * not.
 */
function errorCatalogueDescription(): string {
  const rows = listErrorCodes().map((record) =>
    `| \`${record.code}\` | ${record.status} | ${record.retryable ? 'yes' : 'no'} | ${record.description} |`);
  return [
    'Every error code this API can return.',
    '',
    'Branch on `error`, never on `userMessage`, which is prose and may be reworded. `retryable` says whether an identical retry can plausibly succeed; when it is no, change something first.',
    '',
    '| Code | Status | Retryable | Meaning |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function versioningDescription(): string {
  return [
    `The current dated version is \`${CURRENT_API_VERSION}\`. A key runs under the version current when it was created, so an integration nobody maintains keeps working. Send \`${API_VERSION_HEADER}\` to opt into a different one.`,
    '',
    '**Ships without a version bump**',
    ...VERSION_COMPATIBILITY_POLICY.allowedInPlace.map((entry) => `- ${entry}`),
    '',
    '**Needs a new dated version**',
    ...VERSION_COMPATIBILITY_POLICY.requiresDatedVersion.map((entry) => `- ${entry}`),
    '',
    '**Needs a new path version (`/v2`)**',
    ...VERSION_COMPATIBILITY_POLICY.requiresNewPathVersion.map((entry) => `- ${entry}`),
    '',
    'Deprecations carry RFC 8594 `Sunset` and `Deprecation` headers with at least six months of notice.',
  ].join('\n');
}

export function buildOpenApiDocument(): JsonObject {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Markaestro API',
      version: CURRENT_API_VERSION,
      description: [
        'Create, schedule, and publish social posts, and read back what happened.',
        '',
        '## Authentication',
        '',
        'Every request carries `Authorization: Bearer mk_live_<workspace>.<client>.<secret>`. Keys are bound to exactly one brand: calls auto-target it and a request naming another brand is refused. A `mk_test_` key behaves identically but routes publishing to a sandbox, so nothing reaches a platform.',
        '',
        '## Drafts, schedules, and publishing',
        '',
        'A post is created as a draft unless it carries `scheduledAt`. A draft waits for an explicit publish call; a scheduled post is published by the worker at its time. Scheduling runs the same preflight the composer does, so an unusable connection is reported at create time rather than silently at publish time.',
        '',
        '## Idempotency',
        '',
        'Send `Idempotency-Key` on any create. A replay with the same key and the same body returns the original response verbatim, including partial failures. The same key with a different body is refused rather than replayed.',
        '',
        '## Versioning',
        '',
        versioningDescription(),
        '',
        '## Errors',
        '',
        errorCatalogueDescription(),
      ].join('\n'),
    },
    servers: [{ url: 'https://markaestro.com', description: 'Production' }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Posts', description: 'Create, list, schedule, publish, and bulk-edit posts.' },
      { name: 'Media', description: 'Upload and list media assets.' },
      { name: 'Job runs', description: 'The record of what a publish request did.' },
      { name: 'Webhooks', description: 'Endpoints Markaestro delivers events to.' },
    ],
    paths: {
      '/api/public/v1/posts': {
        get: {
          tags: ['Posts'],
          summary: 'List posts',
          operationId: 'listPosts',
          parameters: [
            ...cursorParams(),
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Return only posts in this status.',
            },
            {
              name: 'productId',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Brand to scope to. A brand-bound key may only name its own brand.',
            },
            VERSION_HEADER_PARAM,
          ],
          responses: { '200': okResponse('A page of posts.', 'PostList'), ...COMMON_ERRORS },
        },
        post: {
          tags: ['Posts'],
          summary: 'Create a post',
          description:
            'Send `channel` for one destination or `targets` for several; they are mutually exclusive. Send `posts` instead to create up to 25 in one call. Include `scheduledAt` to schedule rather than draft.',
          operationId: 'createPost',
          parameters: [VERSION_HEADER_PARAM],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/CreatePost' },
                    { $ref: '#/components/schemas/CreatePostBatch' },
                  ],
                },
              },
            },
          },
          responses: { '201': okResponse('The created post.', 'Post'), ...COMMON_ERRORS },
        },
      },
      '/api/public/v1/posts/{id}': {
        get: {
          tags: ['Posts'],
          summary: 'Get a post',
          operationId: 'getPost',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': okResponse('The post.', 'Post'), '404': errorResponse('No such post, or not in this key’s brand.'), ...COMMON_ERRORS },
        },
        delete: {
          tags: ['Posts'],
          summary: 'Delete a post',
          description: 'Refused while a publish run holds the post, so a live post can never end up with no record.',
          operationId: 'deletePost',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': okResponse('Deleted.', 'Post'), ...COMMON_ERRORS },
        },
      },
      '/api/public/v1/posts/{id}/publish': {
        post: {
          tags: ['Posts'],
          summary: 'Publish a post',
          description: 'Queues a publish run and returns its id. Poll the run, or subscribe to `post.published`.',
          operationId: 'publishPost',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '202': okResponse('The queued run.', 'JobRun'), ...COMMON_ERRORS },
        },
      },
      '/api/public/v1/posts/bulk': {
        post: {
          tags: ['Posts'],
          summary: 'Reschedule, delete, or restatus up to 25 posts',
          description:
            'Partial success is the contract: some posts legitimately cannot take the operation, and the response says which. 400 only when nothing succeeded.',
          operationId: 'bulkPosts',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/BulkPostOperation' } } },
          },
          responses: { '200': okResponse('What applied and what did not.', 'BulkPostResult'), ...COMMON_ERRORS },
        },
      },
      '/api/public/v1/media': {
        get: {
          tags: ['Media'],
          summary: 'List media assets',
          description: 'Includes assets uploaded in the app, not only through the API.',
          operationId: 'listMedia',
          parameters: [
            ...cursorParams(),
            { name: 'type', in: 'query', required: false, schema: { type: 'string', enum: ['image', 'video'] } },
          ],
          responses: { '200': okResponse('A page of assets.', 'MediaList'), ...COMMON_ERRORS },
        },
        post: {
          tags: ['Media'],
          summary: 'Upload a media asset',
          operationId: 'uploadMedia',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
              },
            },
          },
          responses: {
            '201': okResponse('The stored asset.', 'MediaAsset'),
            '402': errorResponse('The workspace is at its storage limit. Delete assets or upgrade.'),
            ...COMMON_ERRORS,
          },
        },
      },
      '/api/public/v1/media/{id}': {
        get: {
          tags: ['Media'],
          summary: 'Get a media asset',
          operationId: 'getMedia',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': okResponse('The asset.', 'MediaAsset'), ...COMMON_ERRORS },
        },
        delete: {
          tags: ['Media'],
          summary: 'Delete a media asset and release its storage',
          description: 'Refused while a scheduled or publishing post still references the asset.',
          operationId: 'deleteMedia',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': okResponse('Deleted, with the bytes released.', 'MediaAsset'), ...COMMON_ERRORS },
        },
      },
      '/api/public/v1/media/upload-sessions': {
        post: {
          tags: ['Media'],
          summary: 'Start a direct-to-storage upload',
          description: 'For files large enough that a multipart POST is the wrong shape. Finalize the session when the upload completes.',
          operationId: 'createUploadSession',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateUploadSession' } } },
          },
          responses: { '201': okResponse('The upload URL and session id.', 'MediaAsset'), ...COMMON_ERRORS },
        },
      },
      '/api/public/v1/job-runs': {
        get: {
          tags: ['Job runs'],
          summary: 'List job runs',
          description: 'How a client that lost a run id recovers it.',
          operationId: 'listJobRuns',
          parameters: [
            ...cursorParams(),
            { name: 'status', in: 'query', required: false, schema: { type: 'string' } },
            { name: 'resourceId', in: 'query', required: false, schema: { type: 'string' }, description: 'Only runs acting on this post.' },
          ],
          responses: { '200': okResponse('A page of runs.', 'JobRunList'), ...COMMON_ERRORS },
        },
      },
      '/api/public/v1/job-runs/{id}': {
        get: {
          tags: ['Job runs'],
          summary: 'Get a job run',
          operationId: 'getJobRun',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': okResponse('The run.', 'JobRun'), ...COMMON_ERRORS },
        },
      },
      '/api/public/v1/webhook-endpoints': {
        get: {
          tags: ['Webhooks'],
          summary: 'List webhook endpoints',
          operationId: 'listWebhookEndpoints',
          responses: { '200': errorResponse('The endpoints.'), ...COMMON_ERRORS },
        },
        post: {
          tags: ['Webhooks'],
          summary: 'Register a webhook endpoint',
          description:
            'The URL must be https and must not resolve to a private address, checked again at delivery time because DNS can change in between.',
          operationId: 'createWebhookEndpoint',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterWebhookEndpoint' } } },
          },
          responses: { '201': errorResponse('The endpoint, with its signing secret returned once.'), ...COMMON_ERRORS },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: `Scopes: ${publicApiScopes.join(', ')}.`,
        },
      },
      schemas: {
        CreatePost: jsonSchema(createPublicPostSchema, 'input'),
        CreatePostBatch: jsonSchema(createPublicPostsBatchSchema, 'input'),
        CreateUploadSession: jsonSchema(createPublicMediaUploadSessionSchema, 'input'),
        RegisterWebhookEndpoint: jsonSchema(registerWebhookEndpointSchema, 'input'),
        BulkPostOperation: jsonSchema(bulkPostOperationSchema, 'input'),
        ListPostsQuery: jsonSchema(listPublicPostsSchema, 'input'),
        Post: jsonSchema(publicPostResponseSchema, 'output'),
        PostList: jsonSchema(publicPostListResponseSchema, 'output'),
        MediaAsset: jsonSchema(publicMediaAssetResponseSchema, 'output'),
        MediaList: jsonSchema(publicMediaListResponseSchema, 'output'),
        JobRun: jsonSchema(publicJobRunResponseSchema, 'output'),
        JobRunList: jsonSchema(publicJobRunListResponseSchema, 'output'),
        BulkPostResult: jsonSchema(publicBulkPostResponseSchema, 'output'),
        Error: jsonSchema(publicErrorResponseSchema, 'output'),
      },
    },
  };
}
