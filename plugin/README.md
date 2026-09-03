# Markaestro plugin for Claude Code

Bundles the `markaestro` skill and the hosted MCP server.

```bash
claude plugin marketplace add D3vBaba/Markaestro
claude plugin install markaestro@markaestro
```

That is the whole setup. The first Markaestro tool call opens your browser:
sign in, pick the workspace and brand the agent may act on, click Allow. To
sign in again later, or switch brands, run `/mcp` and choose `markaestro`.

The MCP server entry points at `https://markaestro.com/api/public/v1/mcp`
with no credentials, so Claude Code uses OAuth. Set `MARKAESTRO_BASE_URL` to
point a local build at another host. For headless use with a static key,
register the server yourself instead:

```bash
claude mcp add --transport http markaestro https://markaestro.com/api/public/v1/mcp \
  --header "Authorization: Bearer mk_live_..."
```
