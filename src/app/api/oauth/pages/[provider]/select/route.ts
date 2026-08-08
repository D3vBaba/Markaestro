import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import {
  getConnection,
  getConnectionRef,
  linkDestinationConnection,
  listProviderConnections,
  listProviderCredentials,
  refForConnection,
  resolveUserAccessToken,
} from '@/lib/platform/connections';
import type { PlatformConnection } from '@/lib/platform/types';
import {
  discoverLinkedInDestinations,
  fetchLinkedInProfile,
  getStoredLinkedInDestinations,
  parseLinkedInScopes,
  type LinkedInDestination,
} from '@/lib/platform/linkedin-api';
import {
  LINKEDIN_COMMUNITY_PROVIDER,
  LINKEDIN_PROFILE_PROVIDER,
} from '@/lib/platform/linkedin-providers';
import { getPinterestApiUrl } from '@/lib/pinterest-api';
import { fetchMetaManagedPages } from '@/lib/meta-pages';
import {
  setMetaProductPageSelections,
  syncGrantedMetaProductConnections,
} from '@/lib/oauth/meta-connection-sync';

export const runtime = 'nodejs';

/** Max destinations linkable in one request. */
const MAX_SELECTION = 50;

type SelectionRequest = {
  ids: string[];
  names: Record<string, string>;
  productId?: string;
  /**
   * 'replace' unlinks destinations the user cleared in the picker; 'add' (the
   * default) leaves already-linked destinations alone so linking an eleventh
   * Page never silently drops the other ten.
   */
  exclusive: boolean;
};

function parseSelection(body: Record<string, unknown>): SelectionRequest {
  const names: Record<string, string> = {};

  const rawIds = Array.isArray(body.pageIds)
    ? body.pageIds
    : body.pageId != null
      ? [body.pageId]
      : [];

  const ids = [...new Set(
    rawIds
      .map((id) => (typeof id === 'string' || typeof id === 'number' ? String(id).trim() : ''))
      .filter(Boolean),
  )];

  if (ids.length === 0) {
    throw new Error('VALIDATION_MISSING_PAGE_ID');
  }
  if (ids.length > MAX_SELECTION) {
    throw new Error('VALIDATION_TOO_MANY_PAGES');
  }

  // Single-selection callers send a matching pageName.
  if (ids.length === 1 && typeof body.pageName === 'string' && body.pageName.trim()) {
    names[ids[0]] = body.pageName.trim();
  }
  if (body.pageNames && typeof body.pageNames === 'object' && !Array.isArray(body.pageNames)) {
    for (const [id, name] of Object.entries(body.pageNames as Record<string, unknown>)) {
      if (typeof name === 'string' && name.trim()) names[id] = name.trim();
    }
  }

  return {
    ids,
    names,
    productId: typeof body.productId === 'string' && body.productId ? body.productId : undefined,
    exclusive: body.mode === 'replace' || body.exclusive === true,
  };
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'integrations.manage');

    const { provider } = await params;
    if (provider !== 'meta' && provider !== 'pinterest' && provider !== 'linkedin') {
      throw new Error('INVALID_PROVIDER');
    }

    const body = (await req.json()) as Record<string, unknown>;
    const selection = parseSelection(body);
    if (!selection.productId) throw new Error('VALIDATION_MISSING_PRODUCT_ID');
    const productId = selection.productId;

    if (provider === 'pinterest') {
      return apiOk(await selectPinterestBoards(ctx.workspaceId, ctx.uid, productId, selection));
    }

    if (provider === 'linkedin') {
      return apiOk(await selectLinkedInDestinations(ctx.workspaceId, ctx.uid, productId, selection));
    }

    return apiOk(await selectMetaPages(ctx.workspaceId, ctx.uid, productId, selection));
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Every authorizing account for a provider on this brand, newest grant first
 * per account. A user can log in with more than one Pinterest or LinkedIn
 * account, and each grant reaches a different set of destinations.
 */
async function resolveCredentials(
  workspaceId: string,
  provider: string,
  productId: string,
): Promise<PlatformConnection[]> {
  const credentials = await listProviderCredentials(workspaceId, provider, productId);
  if (credentials.length > 0) return credentials;

  // Legacy records predate credential keys.
  const pending = await getConnection(workspaceId, provider, productId);
  if (pending?.accessTokenEncrypted) return [pending];

  const linked = await listProviderConnections(workspaceId, provider, productId);
  return linked.filter((conn) => Boolean(conn.accessTokenEncrypted)).slice(0, 1);
}

async function selectMetaPages(
  workspaceId: string,
  userId: string,
  productId: string,
  selection: SelectionRequest,
) {
  const credential = (await getConnection(workspaceId, 'meta')) ||
    (await resolveCredentials(workspaceId, 'meta', productId))[0];
  if (!credential) throw new Error('NOT_FOUND');

  const userAccessToken = resolveUserAccessToken(credential);

  // Resolve selected Pages from either /me/accounts or the granular asset
  // targets returned by Facebook Login for Business.
  const pagesResult = await fetchMetaManagedPages(userAccessToken);
  const selectedPages = selection.ids.map((pageId) => {
    const page = pagesResult.pages.find((candidate) => candidate.id === pageId);
    if (!page?.accessToken) throw new Error('NOT_FOUND');
    return { ...page, name: selection.names[pageId] || page.name };
  });

  await syncGrantedMetaProductConnections({
    workspaceId,
    userId,
    userAccessToken,
    tokenExpiresAt: credential.tokenExpiresAt,
    pages: pagesResult.pages,
  });

  const { linkedPageIds, unlinkedPageIds } = await setMetaProductPageSelections({
    workspaceId,
    productId,
    userId,
    userAccessToken,
    tokenExpiresAt: credential.tokenExpiresAt,
    pages: selectedPages,
    availablePages: pagesResult.pages,
    exclusive: selection.exclusive,
  });

  return {
    ok: true,
    linked: selectedPages.map((page) => ({ id: page.id, name: page.name })),
    unlinked: unlinkedPageIds,
    // Legacy single-selection response fields.
    pageId: linkedPageIds[0] ?? null,
    pageName: selectedPages[0]?.name ?? null,
    igAccountId: null,
  };
}

async function selectPinterestBoards(
  workspaceId: string,
  userId: string,
  productId: string,
  selection: SelectionRequest,
) {
  const credentials = await resolveCredentials(workspaceId, 'pinterest', productId);
  if (credentials.length === 0) throw new Error('NOT_FOUND');

  // Each Pinterest login reaches its own boards, so resolve every grant and
  // link each board with the token that can actually publish to it.
  const boardsByCredential = await Promise.all(credentials.map(async (credential) => {
    const accessToken = resolveUserAccessToken(credential);
    const boardsRes = await fetch(`${getPinterestApiUrl('/boards')}?page_size=100`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const boardsData = await boardsRes.json();
    if (!boardsRes.ok || !Array.isArray(boardsData.items)) {
      return { credential, boards: [] as Array<Record<string, unknown>> };
    }
    return { credential, boards: boardsData.items as Array<Record<string, unknown>> };
  }));

  const linked: Array<{ id: string; name: string }> = [];
  for (const boardId of selection.ids) {
    const owner = boardsByCredential.find((entry) =>
      entry.boards.some((board) => String(board.id) === boardId),
    );
    const board = owner?.boards.find((item) => String(item.id) === boardId);
    if (!owner || !board) throw new Error('NOT_FOUND');

    const boardName = selection.names[boardId] || String(board.name ?? '');
    await linkDestinationConnection({
      credential: owner.credential,
      workspaceId,
      productId,
      userId,
      provider: 'pinterest',
      accountKey: boardId,
      accountLabel: boardName,
      metadata: {
        boardId,
        boardName,
        boardSelectionRequired: false,
      },
    });
    linked.push({ id: boardId, name: boardName });
  }

  const unlinked = await unlinkOtherDestinations(
    workspaceId,
    'pinterest',
    productId,
    selection,
    linked.map((board) => board.id),
  );

  return {
    ok: true,
    linked,
    unlinked,
    id: linked[0]?.id ?? null,
    name: linked[0]?.name ?? null,
  };
}

/**
 * Discover the destinations each stored LinkedIn credential can post as, and
 * refresh the credential's cached discovery metadata.
 */
async function loadLinkedInCandidates(workspaceId: string, productId: string) {
  const providers = [LINKEDIN_PROFILE_PROVIDER, LINKEDIN_COMMUNITY_PROVIDER, 'linkedin'];
  const candidates: Array<{
    connection: PlatformConnection;
    destinations: LinkedInDestination[];
  }> = [];

  // Every LinkedIn member who authorized this brand, so a second login never
  // hides the first member's Pages from the picker.
  const connections = (await Promise.all(
    providers.map((storageProvider) => resolveCredentials(workspaceId, storageProvider, productId)),
  )).flat();

  for (const connection of connections) {
    if (!connection.accessTokenEncrypted) continue;
    const storageProvider = connection.provider;

    const accessToken = resolveUserAccessToken(connection);
    let destinations = getStoredLinkedInDestinations(connection);
    const ref = refForConnection(connection);

    try {
      if (storageProvider === LINKEDIN_PROFILE_PROVIDER) {
        const profile = await fetchLinkedInProfile(accessToken);
        destinations = [profile];
        await ref.update({
          'metadata.linkedinCredentialKind': 'profile',
          'metadata.linkedinProfileId': profile.id,
          'metadata.linkedinProfileUrn': profile.urn,
          'metadata.linkedinProfileName': profile.name,
          'metadata.linkedinProfilePictureUrl': profile.pictureUrl || null,
          'metadata.linkedinPages': [],
          'metadata.linkedinScopes': parseLinkedInScopes(connection.metadata.oauthScopes || connection.metadata.linkedinScopes),
          'metadata.linkedinPageDiscoveryError': null,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const discovery = await discoverLinkedInDestinations(
          accessToken,
          connection.metadata.oauthScopes || connection.metadata.linkedinScopes,
        );
        destinations = storageProvider === LINKEDIN_COMMUNITY_PROVIDER
          ? discovery.pages
          : [discovery.profile, ...discovery.pages];
        await ref.update({
          ...(storageProvider === LINKEDIN_COMMUNITY_PROVIDER
            ? {
              'metadata.linkedinCredentialKind': 'community',
              'metadata.linkedinAuthorizingProfileId': discovery.profile.id,
              'metadata.linkedinAuthorizingProfileUrn': discovery.profile.urn,
              'metadata.linkedinAuthorizingProfileName': discovery.profile.name,
              'metadata.linkedinAuthorizingProfilePictureUrl': discovery.profile.pictureUrl || null,
            }
            : {
              'metadata.linkedinProfileId': discovery.profile.id,
              'metadata.linkedinProfileUrn': discovery.profile.urn,
              'metadata.linkedinProfileName': discovery.profile.name,
              'metadata.linkedinProfilePictureUrl': discovery.profile.pictureUrl || null,
            }),
          'metadata.linkedinPages': discovery.pages,
          'metadata.linkedinScopes': parseLinkedInScopes(connection.metadata.oauthScopes || connection.metadata.linkedinScopes),
          'metadata.linkedinPageDiscoveryError': discovery.pageDiscoveryError || null,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch {
      // Use stored metadata if live discovery is temporarily unavailable.
    }

    candidates.push({ connection, destinations });
  }

  return candidates;
}

async function selectLinkedInDestinations(
  workspaceId: string,
  userId: string,
  productId: string,
  selection: SelectionRequest,
) {
  const candidates = await loadLinkedInCandidates(workspaceId, productId);

  const linked: Array<{ id: string; name: string; type: LinkedInDestination['type'] }> = [];
  const linkedByProvider = new Map<string, string[]>();

  for (const requestedId of selection.ids) {
    const match = candidates
      .map((candidate) => ({
        candidate,
        destination: candidate.destinations.find((destination) =>
          destination.urn === requestedId ||
          destination.id === requestedId ||
          `linkedin:linkedin:${destination.id}` === requestedId
        ) || null,
      }))
      .find((entry) => entry.destination);

    if (!match?.destination) throw new Error('NOT_FOUND');

    const destination = match.destination;
    const name = selection.names[requestedId] || destination.name;
    const provider = match.candidate.connection.provider;

    await linkDestinationConnection({
      credential: match.candidate.connection,
      workspaceId,
      productId,
      userId,
      provider,
      accountKey: destination.urn,
      accountLabel: name,
      metadata: {
        linkedinDestinationUrn: destination.urn,
        linkedinDestinationType: destination.type,
        linkedinDestinationName: name,
        linkedinDestinationAccountId: destination.id,
        linkedinDestinationSelectionRequired: false,
      },
    });

    linked.push({ id: destination.urn, name, type: destination.type });
    linkedByProvider.set(provider, [...(linkedByProvider.get(provider) || []), destination.urn]);
  }

  const unlinked: string[] = [];
  if (selection.exclusive) {
    for (const provider of new Set(candidates.map((candidate) => candidate.connection.provider))) {
      unlinked.push(...await unlinkOtherDestinations(
        workspaceId,
        provider,
        productId,
        selection,
        linkedByProvider.get(provider) || [],
      ));
    }
  }

  return {
    ok: true,
    linked,
    unlinked,
    id: linked[0]?.id ?? null,
    name: linked[0]?.name ?? null,
    type: linked[0]?.type ?? null,
  };
}

/** Remove destinations the user cleared, when the picker replaces the set. */
async function unlinkOtherDestinations(
  workspaceId: string,
  provider: string,
  productId: string,
  selection: SelectionRequest,
  keepIds: string[],
): Promise<string[]> {
  if (!selection.exclusive) return [];

  const keep = new Set(keepIds);
  const existing = await listProviderConnections(workspaceId, provider, productId);
  const removed: string[] = [];

  for (const conn of existing) {
    if (!conn.accountKey || keep.has(conn.accountKey)) continue;
    await getConnectionRef(workspaceId, provider, productId, conn.accountKey).delete();
    removed.push(conn.accountKey);
  }

  return removed;
}
