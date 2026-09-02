# @markaestro/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI
agents (Claude Code, Claude Desktop, Cursor, and any other MCP client) schedule,
publish, and review Markaestro posts through the public API.

One API key, one brand: every Markaestro key is bound to a single brand, so the
server operates on that brand only. Run one server per brand if an agent needs
several.

## Tools

| Tool | What it does |
| --- | --- |
| `list_products` | The brand this key is bound to and its connected channels |
| `list_destinations` | Publishable destinations of the brand (pages, accounts) with ids |
| `list_posts`, `get_post` | Read posts by status, page through with `cursor` |
| `create_post` | Save a draft, or schedule when `scheduledAt` is set |
| `publish_post` | Queue an immediate publish; returns a job run |
| `delete_post` | Delete a draft or cancel a scheduled post |
| `bulk_posts` | Reschedule, delete, or restatus up to 25 posts |
| `upload_media` | Upload from a file path, URL, or data URL; returns the asset id |
| `list_media` | Uploaded assets and their reference counts |
| `get_job_run`, `list_job_runs` | Follow a publish to succeeded or failed |
| `list_webhook_endpoints`, `create_webhook_endpoint` | Webhook registration |
| `get_channel_rules` | Per-channel media, caption, and delivery-mode rules |

Also served: the `markaestro://channel-rules` resource and a `schedule_post`
prompt that walks an agent through a safe scheduling flow.

Posting is draft-first. `create_post` without `scheduledAt` never publishes;
`publish_post` is the only tool that publishes now, and its description tells
the agent to confirm with the user first.

## Setup

1. Create an API key in Markaestro under Settings > API Access. Pick the brand,
   the scopes the agent needs (`products.read`, `posts.read`, `posts.write`,
   `media.write`, and `posts.publish` if it may publish), and prefer a **test**
   key while you evaluate.
2. Give the key to the server through `MARKAESTRO_API_KEY`.

### Claude Code

```bash
claude mcp add markaestro -e MARKAESTRO_API_KEY=mk_live_... -- npx -y @markaestro/mcp
```

### Claude Desktop, Cursor, and other JSON configs

```json
{
  "mcpServers": {
    "markaestro": {
      "command": "npx",
      "args": ["-y", "@markaestro/mcp"],
      "env": { "MARKAESTRO_API_KEY": "mk_live_..." }
    }
  }
}
```

### Environment

| Variable | Required | Default |
| --- | --- | --- |
| `MARKAESTRO_API_KEY` | yes | n/a |
| `MARKAESTRO_BASE_URL` | no | `https://markaestro.com` |

## What the server does for you

- Sends an `Idempotency-Key` on every mutation, minted once per call, so a
  retried request replays instead of double-posting.
- Retries `429` and transient `5xx` responses using the server's `Retry-After`.
- Runs the three-step direct media upload (session, `PUT` to storage,
  finalize) and never sends the API key to the storage URL.
- Returns API failures as tool errors with the stable error `code`, any
  per-channel `issues`, and a hint about what to change.

## Development

```bash
cd mcp
npm install
npm run build
MARKAESTRO_API_KEY=mk_test_... MARKAESTRO_BASE_URL=http://localhost:3000 npm run smoke
```

Unit tests live in `src/__tests__` and run with the repository's `npm test`.
The smoke script starts the built server over stdio, lists tools, reads the
brand, creates a draft, reads it back, and deletes it. Nothing is published.
