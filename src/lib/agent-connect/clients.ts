/**
 * The one list of ways an AI agent connects to Markaestro.
 *
 * Every snippet on /developers/agents, in public/llms.txt, in the skill, and
 * in the READMEs should trace back to a constant in this file so the clients
 * we say we support and the exact commands we show them cannot drift apart.
 *
 * Nothing here is translated: the strings are commands, config files, and
 * URLs meant to be pasted into a terminal or a config file verbatim. The
 * prose around them lives in `developersAgents.json` under `connect`.
 *
 * Two paths, and every client uses one or both:
 *
 *   oauth  The client adds the hosted server URL with no credential. The
 *          first call is answered 401, the client discovers the OAuth server,
 *          registers itself, and opens the browser on the consent page. The
 *          token it receives is an API key bound to the brand the user chose.
 *   key    The client cannot open a browser (CI, a server-side API call, a
 *          beta agent without OAuth). A workspace API key from Settings, API
 *          is passed as a bearer header instead. Same server, same rules.
 */

export const MARKAESTRO_ORIGIN = 'https://markaestro.com';
export const MCP_SERVER_URL = `${MARKAESTRO_ORIGIN}/api/public/v1/mcp`;
export const AGENTS_PAGE_URL = `${MARKAESTRO_ORIGIN}/developers/agents`;
export const API_KEY_SETTINGS_PATH = '/settings?tab=api&preset=agent';

/**
 * OAuth client ids Markaestro registers itself, for clients whose connector
 * dialog asks for a client id instead of registering dynamically. Seeded by
 * `scripts/seed-oauth-clients.mjs`; the id is public (PKCE, no secret).
 */
export const FIRST_PARTY_OAUTH_CLIENT_IDS = {
  grokWeb: 'markaestro-grok-web',
} as const;

export const AGENT_CLIENT_IDS = [
  'claude-code',
  'claude',
  'cursor',
  'chatgpt',
  'grok',
  'grok-bot',
  'openclaw',
  'hermes',
  'generic',
  'headless',
] as const;

export type AgentClientId = (typeof AGENT_CLIENT_IDS)[number];

export function isAgentClientId(value: unknown): value is AgentClientId {
  return typeof value === 'string' && (AGENT_CLIENT_IDS as readonly string[]).includes(value);
}

/** Which of the two paths the client can take. `both` prefers the sign-in. */
export type AgentAuthPath = 'oauth' | 'key' | 'both';

export type SnippetKind = 'bash' | 'json' | 'yaml' | 'toml' | 'text';

export type AgentSnippet = {
  /** Stable id, also the key of an optional caption in the page copy. */
  id: string;
  kind: SnippetKind;
  code: string;
};

export type AgentClient = {
  id: AgentClientId;
  auth: AgentAuthPath;
  snippets: readonly AgentSnippet[];
  /** A one-click install link the client's own URL scheme understands. */
  deeplink?: string;
  /** The client vendor's own documentation for adding an MCP server. */
  docsUrl?: string;
};

/**
 * Cursor installs an MCP server from a `cursor://` link carrying the server
 * name and its `mcp.json` entry, base64 encoded. Works from a web page, a
 * README, or a chat message; the browser hands it to Cursor.
 */
export function cursorInstallDeeplink(name: string, config: Record<string, unknown>): string {
  const json = JSON.stringify(config);
  // The config is ASCII (a URL and a few keys); btoa is available in the
  // browser and in Node 20, so the same module serves the page and the tests.
  const encoded = btoa(json);
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(encoded)}`;
}

const genericHttpConfig = `{
  "mcpServers": {
    "markaestro": {
      "type": "http",
      "url": "${MCP_SERVER_URL}"
    }
  }
}`;

const CLAUDE_CODE: AgentClient = {
  id: 'claude-code',
  auth: 'both',
  docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/mcp',
  snippets: [
    {
      id: 'plugin',
      kind: 'bash',
      code: `# The plugin bundles the skill and the hosted server.
claude plugin marketplace add D3vBaba/Markaestro
claude plugin install markaestro@markaestro

# Or add just the server. No key, no header: the first call opens the browser.
claude mcp add --transport http markaestro ${MCP_SERVER_URL}`,
    },
  ],
};

const CLAUDE: AgentClient = {
  id: 'claude',
  auth: 'oauth',
  docsUrl: 'https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp',
  snippets: [{ id: 'url', kind: 'text', code: MCP_SERVER_URL }],
};

const CURSOR: AgentClient = {
  id: 'cursor',
  auth: 'both',
  docsUrl: 'https://cursor.com/docs/mcp',
  deeplink: cursorInstallDeeplink('markaestro', { url: MCP_SERVER_URL }),
  snippets: [
    {
      id: 'config',
      kind: 'json',
      code: `// .cursor/mcp.json (project) or ~/.cursor/mcp.json (global)
{
  "mcpServers": {
    "markaestro": {
      "url": "${MCP_SERVER_URL}"
    }
  }
}`,
    },
    {
      id: 'headless',
      kind: 'json',
      code: `// Without a browser: pass a workspace API key instead.
{
  "mcpServers": {
    "markaestro": {
      "url": "${MCP_SERVER_URL}",
      "headers": { "Authorization": "Bearer mk_live_..." }
    }
  }
}`,
    },
  ],
};

const CHATGPT: AgentClient = {
  id: 'chatgpt',
  auth: 'oauth',
  docsUrl: 'https://developers.openai.com/api/docs/mcp',
  snippets: [{ id: 'url', kind: 'text', code: MCP_SERVER_URL }],
};

const GROK: AgentClient = {
  id: 'grok',
  auth: 'both',
  docsUrl: 'https://docs.x.ai/grok/connectors',
  snippets: [
    {
      id: 'web',
      kind: 'text',
      code: `Server URL:  ${MCP_SERVER_URL}
Client ID:   ${FIRST_PARTY_OAUTH_CLIENT_IDS.grokWeb}   (only if the dialog asks for one)
Secret:      leave blank (public client, PKCE S256)`,
    },
    {
      id: 'build',
      kind: 'bash',
      code: `# Grok Build (terminal). The first tool call opens the browser.
grok mcp add --transport http markaestro ${MCP_SERVER_URL}
grok mcp doctor markaestro

# Headless: pass a workspace API key instead.
grok mcp add --transport http markaestro ${MCP_SERVER_URL} \\
  --header "Authorization: Bearer \${MARKAESTRO_API_KEY}"`,
    },
    {
      id: 'api',
      kind: 'json',
      code: `// xAI Responses API: one entry in the request's "tools" array.
// Server-side, so it always uses a workspace API key.
{
  "type": "mcp",
  "server_url": "${MCP_SERVER_URL}",
  "server_label": "markaestro",
  "authorization": "Bearer mk_live_...",
  "allowed_tools": ["list_products", "list_destinations", "upload_media",
                    "create_post", "publish_post", "get_job_run"]
}`,
    },
  ],
};

const GROK_BOT: AgentClient = {
  id: 'grok-bot',
  auth: 'key',
  docsUrl: 'https://x.ai/news/introducing-grok-bot',
  snippets: [
    {
      id: 'key',
      kind: 'text',
      code: `Server URL:   ${MCP_SERVER_URL}
Header name:  Authorization        (or x-api-key if that is the only field)
Header value: Bearer mk_live_...   (with x-api-key: just mk_live_...)`,
    },
  ],
};

const OPENCLAW: AgentClient = {
  id: 'openclaw',
  auth: 'both',
  docsUrl: 'https://docs.openclaw.ai/tools/mcp',
  snippets: [
    {
      id: 'cli',
      kind: 'bash',
      code: `openclaw mcp add markaestro \\
  --url ${MCP_SERVER_URL} \\
  --transport streamable-http \\
  --auth oauth
openclaw mcp login markaestro      # prints the sign-in URL; add --code <code> when headless
openclaw mcp reload`,
    },
    {
      id: 'config',
      kind: 'json',
      code: `// ~/.openclaw/openclaw.json
{
  "mcp": {
    "servers": {
      "markaestro": {
        "url": "${MCP_SERVER_URL}",
        "transport": "streamable-http",
        "auth": "oauth"
      }
    }
  }
}`,
    },
    {
      id: 'headless',
      kind: 'bash',
      code: `# Without a browser: a workspace API key from the environment.
openclaw mcp add markaestro \\
  --url ${MCP_SERVER_URL} \\
  --transport streamable-http \\
  --header "Authorization: Bearer \${MARKAESTRO_API_KEY}"`,
    },
  ],
};

const HERMES: AgentClient = {
  id: 'hermes',
  auth: 'both',
  docsUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/',
  snippets: [
    {
      id: 'config',
      kind: 'yaml',
      code: `# ~/.hermes/config.yaml
mcp_servers:
  markaestro:
    url: "${MCP_SERVER_URL}"
    auth: oauth`,
    },
    {
      id: 'headless',
      kind: 'yaml',
      code: `# Without a browser: a workspace API key, kept in ~/.hermes/.env
mcp_servers:
  markaestro:
    url: "${MCP_SERVER_URL}"
    headers:
      Authorization: "Bearer \${MARKAESTRO_API_KEY}"`,
    },
  ],
};

const GENERIC: AgentClient = {
  id: 'generic',
  auth: 'both',
  snippets: [{ id: 'config', kind: 'json', code: genericHttpConfig }],
};

const HEADLESS: AgentClient = {
  id: 'headless',
  auth: 'key',
  snippets: [
    {
      id: 'header',
      kind: 'bash',
      code: `# CI, cron, or any client without a browser: pass a key instead.
claude mcp add --transport http markaestro ${MCP_SERVER_URL} \\
  --header "Authorization: Bearer mk_live_..."

# Local stdio server (can also upload files from disk)
claude mcp add markaestro -e MARKAESTRO_API_KEY=mk_live_... -- npx -y @markaestro/mcp`,
    },
    {
      id: 'config',
      kind: 'json',
      code: `{
  "mcpServers": {
    "markaestro": {
      "type": "http",
      "url": "${MCP_SERVER_URL}",
      "headers": { "Authorization": "Bearer mk_live_..." }
    }
  }
}`,
    },
  ],
};

export const AGENT_CLIENTS: readonly AgentClient[] = [
  CLAUDE_CODE,
  CLAUDE,
  CURSOR,
  CHATGPT,
  GROK,
  GROK_BOT,
  OPENCLAW,
  HERMES,
  GENERIC,
  HEADLESS,
];

export function getAgentClient(id: AgentClientId): AgentClient {
  const client = AGENT_CLIENTS.find((c) => c.id === id);
  if (!client) throw new Error(`Unknown agent client: ${id}`);
  return client;
}
