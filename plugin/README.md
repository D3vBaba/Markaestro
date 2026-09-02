# Markaestro plugin for Claude Code

Bundles the `markaestro` skill and the hosted MCP server.

```bash
claude plugin marketplace add D3vBaba/Markaestro
claude plugin install markaestro@markaestro
export MARKAESTRO_API_KEY=mk_live_...   # from Settings > API Access
```

The MCP server entry points at `https://markaestro.com/api/public/v1/mcp`
and sends your key as a bearer header. Set `MARKAESTRO_BASE_URL` to point a
local build at another host.
