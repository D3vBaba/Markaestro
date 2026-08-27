const META_GRAPH_API = 'https://graph.facebook.com/v25.0';

/** Bound the /me/accounts cursor walk so a paging loop can never run away. */
const MAX_ACCOUNT_PAGES = 20;

type MetaGraphError = {
  error?: {
    message?: string;
  };
};

type MetaPagePayload = MetaGraphError & {
  id?: unknown;
  name?: unknown;
  access_token?: unknown;
};

type MetaAccountsPayload = MetaGraphError & {
  data?: MetaPagePayload[];
  paging?: {
    next?: unknown;
    cursors?: { after?: unknown };
  };
};

type MetaDebugTokenPayload = MetaGraphError & {
  data?: {
    granular_scopes?: Array<{
      scope?: unknown;
      target_ids?: unknown;
    }>;
  };
};

export type MetaManagedPage = {
  id: string;
  name: string;
  accessToken: string | null;
};

export type MetaManagedPagesResult = {
  pages: MetaManagedPage[];
  error?: string;
  /**
   * True only when the grant was enumerated end to end — every /me/accounts
   * page was read and the granular asset grant was inspected successfully.
   *
   * A partial read must never be mistaken for "these are all the Pages the
   * user granted": callers use that conclusion to revoke Page connections, and
   * a truncated or failed list would revoke Pages that are perfectly healthy.
   */
  complete: boolean;
};

function errorMessage(payload: MetaGraphError, fallback: string) {
  return payload.error?.message || fallback;
}

function normalizePage(page: MetaPagePayload): MetaManagedPage | null {
  if (typeof page.id !== 'string' || !page.id) return null;
  return {
    id: page.id,
    name: typeof page.name === 'string' && page.name ? page.name : page.id,
    accessToken:
      typeof page.access_token === 'string' && page.access_token
        ? page.access_token
        : null,
  };
}

/**
 * Walk every page of /me/accounts. The endpoint caps `limit`, so an account
 * managing more Pages than one response holds used to silently return a
 * truncated list.
 */
async function fetchAccountPages(accessToken: string): Promise<{
  pages: MetaManagedPage[];
  error?: string;
  complete: boolean;
}> {
  const pages: MetaManagedPage[] = [];
  let url: string | null =
    `${META_GRAPH_API}/me/accounts?fields=id,name,access_token&limit=100`;

  for (let i = 0; i < MAX_ACCOUNT_PAGES && url; i++) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = (await res.json()) as MetaAccountsPayload;

    if (!res.ok) {
      return {
        pages,
        error: errorMessage(payload, 'Failed to list Facebook Pages'),
        complete: false,
      };
    }

    for (const entry of payload.data || []) {
      const page = normalizePage(entry);
      if (page) pages.push(page);
    }

    const next = payload.paging?.next;
    url = typeof next === 'string' && next ? next : null;
  }

  // Still more cursors than the bound allows: the list is not exhaustive.
  return { pages, complete: !url };
}

async function fetchGrantedPageIds(accessToken: string): Promise<{
  ids: string[];
  error?: string;
  complete: boolean;
}> {
  const appId = process.env.META_APP_ID || '';
  const appSecret = process.env.META_APP_SECRET || '';
  if (!appId || !appSecret) {
    return {
      ids: [],
      error: 'Meta app credentials are unavailable for asset discovery',
      complete: false,
    };
  }

  const url = new URL(`${META_GRAPH_API}/debug_token`);
  url.searchParams.set('input_token', accessToken);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${appId}|${appSecret}` },
  });
  const payload = (await res.json()) as MetaDebugTokenPayload;
  if (!res.ok || !payload.data) {
    return {
      ids: [],
      error: errorMessage(payload, 'Failed to inspect Meta asset grants'),
      complete: false,
    };
  }

  const ids = new Set<string>();
  for (const grant of payload.data.granular_scopes || []) {
    if (
      typeof grant.scope !== 'string' ||
      (!grant.scope.startsWith('pages_') && grant.scope !== 'read_insights') ||
      !Array.isArray(grant.target_ids)
    ) {
      continue;
    }
    for (const targetId of grant.target_ids) {
      if (typeof targetId === 'string' && targetId) ids.add(targetId);
    }
  }
  return { ids: [...ids], complete: true };
}

async function fetchPageById(pageId: string, accessToken: string) {
  const url = new URL(`${META_GRAPH_API}/${encodeURIComponent(pageId)}`);
  url.searchParams.set('fields', 'id,name,access_token');
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = (await res.json()) as MetaPagePayload;
  if (!res.ok) return null;
  return normalizePage(payload);
}

/**
 * Discover Facebook Pages selected in Meta's authorization dialog.
 *
 * Two sources describe the grant and neither is complete on its own:
 * `/me/accounts` lists Pages the user holds a role on, while Facebook Login for
 * Business reports the selected assets as granular permission targets. They are
 * unioned so a Page that appears in only one source is still returned — reading
 * just one of them under-reported the grant, and callers that revoke on absence
 * then disconnected healthy Pages.
 */
export async function fetchMetaManagedPages(
  accessToken: string,
): Promise<MetaManagedPagesResult> {
  const [accounts, granted] = await Promise.all([
    fetchAccountPages(accessToken),
    fetchGrantedPageIds(accessToken),
  ]);

  const byId = new Map<string, MetaManagedPage>();
  for (const page of accounts.pages) byId.set(page.id, page);

  // Pull in granted assets /me/accounts did not describe.
  const missingIds = granted.ids.filter((id) => !byId.has(id));
  const fetched = await Promise.all(
    missingIds.map(async (id) => ({ id, page: await fetchPageById(id, accessToken) })),
  );
  let allResolved = true;
  for (const { page } of fetched) {
    if (!page) {
      allResolved = false;
      continue;
    }
    byId.set(page.id, page);
  }

  const pages = [...byId.values()];
  const errors = [accounts.error, granted.error].filter(Boolean);
  const complete = accounts.complete && granted.complete && allResolved;

  if (pages.length === 0) {
    return {
      pages: [],
      error: errors[0] || 'No Facebook Pages were granted',
      complete,
    };
  }

  return {
    pages,
    ...(errors.length ? { error: errors.join(' ') } : {}),
    complete,
  };
}
