import { describe, expect, it } from 'vitest';
import {
  AGENT_CLIENT_IDS,
  AGENT_CLIENTS,
  FIRST_PARTY_OAUTH_CLIENT_IDS,
  MCP_SERVER_URL,
  cursorInstallDeeplink,
  getAgentClient,
  isAgentClientId,
} from '../clients';

describe('agent connect clients', () => {
  it('lists every client id exactly once, in the declared order', () => {
    expect(AGENT_CLIENTS.map((c) => c.id)).toEqual([...AGENT_CLIENT_IDS]);
    expect(new Set(AGENT_CLIENTS.map((c) => c.id)).size).toBe(AGENT_CLIENTS.length);
  });

  it('points every snippet at the one hosted server URL', () => {
    for (const client of AGENT_CLIENTS) {
      expect(client.snippets.length).toBeGreaterThan(0);
      const joined = client.snippets.map((s) => s.code).join('\n');
      expect(joined).toContain(MCP_SERVER_URL);
      expect(new Set(client.snippets.map((s) => s.id)).size).toBe(client.snippets.length);
    }
  });

  it('keeps the copy rules: no em dashes, no sparkles, no placeholder live keys', () => {
    for (const client of AGENT_CLIENTS) {
      for (const snippet of client.snippets) {
        expect(snippet.code).not.toMatch(/—/);
        expect(snippet.code).not.toMatch(/✨/);
        // Only the documented placeholder shape may appear, never a real key.
        expect(snippet.code).not.toMatch(/mk_live_[A-Za-z0-9]{8,}\./);
      }
    }
  });

  it('gives key-only clients a header snippet and OAuth-only clients none', () => {
    for (const client of AGENT_CLIENTS) {
      const joined = client.snippets.map((s) => s.code).join('\n');
      if (client.auth === 'key') expect(joined).toMatch(/Authorization|MARKAESTRO_API_KEY|mk_live_/);
      if (client.auth === 'oauth') expect(joined).not.toMatch(/mk_live_/);
    }
  });

  it('builds the Cursor deeplink the way Cursor documents it', () => {
    const link = cursorInstallDeeplink('markaestro', { url: MCP_SERVER_URL });
    const url = new URL(link);
    expect(url.protocol).toBe('cursor:');
    expect(url.host).toBe('anysphere.cursor-deeplink');
    expect(url.pathname).toBe('/mcp/install');
    expect(url.searchParams.get('name')).toBe('markaestro');
    const decoded = JSON.parse(atob(url.searchParams.get('config')!));
    expect(decoded).toEqual({ url: MCP_SERVER_URL });
    expect(getAgentClient('cursor').deeplink).toBe(link);
  });

  it('names the first-party grok.com client id in the Grok snippet', () => {
    const grok = getAgentClient('grok');
    expect(grok.snippets.map((s) => s.code).join('\n')).toContain(FIRST_PARTY_OAUTH_CLIENT_IDS.grokWeb);
    expect(FIRST_PARTY_OAUTH_CLIENT_IDS.grokWeb).toMatch(/^markaestro-[a-z0-9-]+$/);
  });

  it('validates client ids from the query string', () => {
    expect(isAgentClientId('cursor')).toBe(true);
    expect(isAgentClientId('grok-bot')).toBe(true);
    expect(isAgentClientId('CURSOR')).toBe(false);
    expect(isAgentClientId('')).toBe(false);
    expect(isAgentClientId(null)).toBe(false);
    expect(() => getAgentClient('nope' as never)).toThrow();
  });
});
