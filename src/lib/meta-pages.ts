const META_GRAPH_API = 'https://graph.facebook.com/v22.0';

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

async function fetchGrantedPageIds(accessToken: string) {
  const appId = process.env.META_APP_ID || '';
  const appSecret = process.env.META_APP_SECRET || '';
  if (!appId || !appSecret) {
    return {
      ids: [] as string[],
      error: 'Meta app credentials are unavailable for asset discovery',
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
      ids: [] as string[],
      error: errorMessage(payload, 'Failed to inspect Meta asset grants'),
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
  return { ids: [...ids] };
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
 * Most user tokens expose Pages through `/me/accounts`. Facebook Login for
 * Business can instead return the selected assets only as granular permission
 * targets. The fallback keeps the Page picker aligned with the exact assets
 * the user granted without broadening the requested scopes.
 */
export async function fetchMetaManagedPages(
  accessToken: string,
): Promise<MetaManagedPagesResult> {
  const accountsRes = await fetch(
    `${META_GRAPH_API}/me/accounts?fields=id,name,access_token&limit=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const accountsPayload = (await accountsRes.json()) as MetaAccountsPayload;
  const accountPages = Array.isArray(accountsPayload.data)
    ? accountsPayload.data
        .map(normalizePage)
        .filter((page): page is MetaManagedPage => page !== null)
    : [];
  if (accountPages.length > 0) return { pages: accountPages };

  const granted = await fetchGrantedPageIds(accessToken);
  if (granted.ids.length === 0) {
    return {
      pages: [],
      error:
        granted.error ||
        errorMessage(accountsPayload, 'No Facebook Pages were granted'),
    };
  }

  const grantedPages = (
    await Promise.all(
      granted.ids.map((pageId) => fetchPageById(pageId, accessToken)),
    )
  ).filter((page): page is MetaManagedPage => page !== null);

  if (grantedPages.length === 0) {
    return {
      pages: [],
      error: errorMessage(
        accountsPayload,
        'The granted Facebook Pages could not be loaded',
      ),
    };
  }
  return { pages: grantedPages };
}
