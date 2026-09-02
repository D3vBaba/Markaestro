# Markaestro SDKs

Hand-written thin clients over the public API. The generated OpenAPI
description (`openapi/markaestro-v1.json`, served at
`/api/public/v1/openapi.json`) is the contract; these wrappers add the parts
a generator cannot: automatic idempotency keys, `Retry-After`-aware retries,
the one-call publish flow, and webhook verification.

| Package | Directory | Publish with |
| --- | --- | --- |
| `@markaestro/sdk` (TypeScript) | `sdk/typescript` | `npm publish` (runs `tsc` via prepublishOnly) |
| `markaestro` (Python) | `sdk/python` | `python -m build && twine upload dist/*` |
| `@markaestro/mcp` (MCP server for AI agents) | `mcp` | `npm publish` (runs `tsc` via prepublishOnly) |

Release checklist: bump the version, update `docs/API_CHANGELOG.md`, publish.
This repo deploys by push-to-main with no CI runner, so publishing is a
manual step by design; if a GitHub Actions setup is added later, wire these
two commands into a tag-triggered workflow.
