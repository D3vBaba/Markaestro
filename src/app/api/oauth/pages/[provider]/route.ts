import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import {
  listProviderConnections,
  listProviderCredentials,
  listWorkspaceCredentials,
  refForConnection,
  resolveUserAccessToken,
} from '@/lib/platform/connections';
import {
  discoverLinkedInDestinations,
  fetchLinkedInProfile,
  getStoredLinkedInDestinations,
  parseLinkedInScopes,
  sanitizeLinkedInError,
} from '@/lib/platform/linkedin-api';
import type { PlatformConnection } from '@/lib/platform/types';
import {
  LINKEDIN_COMMUNITY_PROVIDER,
  LINKEDIN_PROFILE_PROVIDER,
} from '@/lib/platform/linkedin-providers';
import { getPinterestApiUrl } from '@/lib/pinterest-api';
import { fetchMetaManagedPages } from '@/lib/meta-pages';

export const runtime = 'nodejs';


async function fetchPinterestBoards(accessToken: string) {
  const res = await fetch(`${getPinterestApiUrl('/boards')}?page_size=100`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok || !Array.isArray(data.items)) {
    return { pages: [], error: data.message || 'Failed to fetch boards' };
  }
  return {
    pages: data.items.map((b: Record<string, unknown>) => ({
      id: String(b.id),
      name: String(b.name ?? ''),
      privacy: typeof b.privacy === 'string' ? b.privacy : 'PUBLIC',
      pinCount: typeof b.pin_count === 'number' ? b.pin_count : 0,
    })),
  };
}

function toLinkedInPickerDestination(destination: ReturnType<typeof getStoredLinkedInDestinations>[number]) {
  return {
    id: destination.urn,
    name: destination.type === 'profile' ? `${destination.name} (Profile)` : destination.name,
    type: destination.type,
    accountId: destination.id,
    urn: destination.urn,
    role: destination.role || null,
  };
}

async function fetchLinkedInDestinations(accessToken: string, conn: PlatformConnection | null) {
  try {
    const discovery = await discoverLinkedInDestinations(accessToken, conn?.metadata.oauthScopes || conn?.metadata.linkedinScopes);
    return {
      pages: [discovery.profile, ...discovery.pages].map(toLinkedInPickerDestination),
      ...(discovery.pageDiscoveryError ? { error: discovery.pageDiscoveryError } : {}),
    };
  } catch (error) {
    const stored = conn ? getStoredLinkedInDestinations(conn) : [];
    return {
      pages: stored.map(toLinkedInPickerDestination),
      error: sanitizeLinkedInError(error),
    };
  }
}

async function fetchLinkedInProfileDestinations(
  conn: PlatformConnection | null,
  connRef?: FirebaseFirestore.DocumentReference,
) {
  if (!conn?.accessTokenEncrypted) return { pages: [] as ReturnType<typeof toLinkedInPickerDestination>[] };
  const accessToken = resolveUserAccessToken(conn);
  try {
    const profile = await fetchLinkedInProfile(accessToken);
    if (connRef) {
      await connRef.update({
        'metadata.linkedinCredentialKind': 'profile',
        'metadata.linkedinProfileId': profile.id,
        'metadata.linkedinProfileUrn': profile.urn,
        'metadata.linkedinProfileName': profile.name,
        'metadata.linkedinProfilePictureUrl': profile.pictureUrl || null,
        'metadata.linkedinPages': [],
        'metadata.linkedinScopes': parseLinkedInScopes(conn.metadata.oauthScopes || conn.metadata.linkedinScopes),
        'metadata.linkedinPageDiscoveryError': null,
        updatedAt: new Date().toISOString(),
      });
    }
    return { pages: [profile].map(toLinkedInPickerDestination) };
  } catch (error) {
    const stored = getStoredLinkedInDestinations(conn).filter((destination) => destination.type === 'profile');
    return {
      pages: stored.map(toLinkedInPickerDestination),
      error: sanitizeLinkedInError(error),
    };
  }
}

async function fetchLinkedInCommunityDestinations(
  conn: PlatformConnection | null,
  connRef?: FirebaseFirestore.DocumentReference,
) {
  if (!conn?.accessTokenEncrypted) return { pages: [] as ReturnType<typeof toLinkedInPickerDestination>[] };
  const accessToken = resolveUserAccessToken(conn);
  try {
    const discovery = await discoverLinkedInDestinations(accessToken, conn.metadata.oauthScopes || conn.metadata.linkedinScopes);
    if (connRef) {
      await connRef.update({
        'metadata.linkedinCredentialKind': 'community',
        'metadata.linkedinAuthorizingProfileId': discovery.profile.id,
        'metadata.linkedinAuthorizingProfileUrn': discovery.profile.urn,
        'metadata.linkedinAuthorizingProfileName': discovery.profile.name,
        'metadata.linkedinAuthorizingProfilePictureUrl': discovery.profile.pictureUrl || null,
        'metadata.linkedinPages': discovery.pages,
        'metadata.linkedinScopes': parseLinkedInScopes(conn.metadata.oauthScopes || conn.metadata.linkedinScopes),
        'metadata.linkedinPageDiscoveryError': discovery.pageDiscoveryError || null,
        updatedAt: new Date().toISOString(),
      });
    }
    return {
      pages: discovery.pages.map(toLinkedInPickerDestination),
      ...(discovery.pageDiscoveryError ? { error: discovery.pageDiscoveryError } : {}),
    };
  } catch (error) {
    const stored = getStoredLinkedInDestinations(conn).filter((destination) => destination.type === 'page');
    return {
      pages: stored.map(toLinkedInPickerDestination),
      error: sanitizeLinkedInError(error),
    };
  }
}

/** Human-readable name for a connected account, for grouping in the picker. */
function accountLabelFor(conn: PlatformConnection, provider: string): string {
  const metadata = conn.metadata || {};
  for (const key of ['username', 'displayName', 'linkedinProfileName', 'linkedinAuthorizingProfileName']) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return conn.credentialKey ? `${provider} account ${conn.credentialKey}` : provider;
}

/** Two accounts can surface the same destination; show it once. */
function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    if (!seen.has(item.id)) seen.set(item.id, item);
  }
  return [...seen.values()];
}

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'integrations.manage');
    const { provider } = await params;

    if (provider !== 'meta' && provider !== 'pinterest' && provider !== 'linkedin') {
      throw new Error('INVALID_PROVIDER');
    }

    const url = new URL(req.url);
    const productId = url.searchParams.get('productId') || undefined;

    // Destinations already linked to this brand, so the picker can show which
    // Pages/boards are in use instead of implying only one may be chosen.
    const linkedIds = productId
      ? (await listProviderConnections(ctx.workspaceId, provider, productId))
        .map((linked) => linked.accountKey)
        .filter((id): id is string => Boolean(id))
      : [];

    if (provider === 'linkedin') {
      const credentialsByProvider = await Promise.all(
        [LINKEDIN_PROFILE_PROVIDER, LINKEDIN_COMMUNITY_PROVIDER, 'linkedin'].map(
          async (storageProvider) => ({
            storageProvider,
            credentials: productId
              ? await listProviderCredentials(ctx.workspaceId, storageProvider, productId)
              : [],
          }),
        ),
      );

      const profileCreds = credentialsByProvider[0].credentials;
      const communityCreds = credentialsByProvider[1].credentials;
      const legacyCreds = credentialsByProvider[2].credentials;

      // Every authorizing member is enumerated, so a second LinkedIn login
      // never hides the first member's Pages.
      const results = [
        ...await Promise.all(profileCreds.map((conn) =>
          fetchLinkedInProfileDestinations(conn, refForConnection(conn)))),
        ...await Promise.all(communityCreds.map((conn) =>
          fetchLinkedInCommunityDestinations(conn, refForConnection(conn)))),
        ...(profileCreds.length === 0 && communityCreds.length === 0
          ? await Promise.all(legacyCreds.map((conn) =>
            fetchLinkedInDestinations(resolveUserAccessToken(conn), conn)))
          : []),
      ];

      const pages = dedupeById(results.flatMap((result) => result.pages));
      const errors = results.map((result) => result.error).filter(Boolean);
      return apiOk({
        pages,
        linkedIds,
        ...(errors.length ? { error: [...new Set(errors)].join(' ') } : {}),
      });
    }

    // Meta credentials live at workspace scope, one per connected Facebook
    // account; other providers authorize per product. Either way there can be
    // several, and each reaches only its own Pages/boards.
    const credentials = provider === 'meta'
      ? await listWorkspaceCredentials(ctx.workspaceId, 'meta')
      : productId
        ? await listProviderCredentials(ctx.workspaceId, provider, productId)
        : [];

    if (credentials.length === 0) {
      return apiOk({ pages: [], linkedIds: [], accounts: [] });
    }

    const fetched = await Promise.all(credentials.map(async (conn) => {
      const accessToken = resolveUserAccessToken(conn);
      // Which connected account these destinations belong to, so the picker can
      // group them and the caller can link each with the right credential.
      const accountId = conn.credentialKey || conn.connectionId || provider;
      const accountLabel = accountLabelFor(conn, provider);

      if (provider === 'meta') {
        const result = await fetchMetaManagedPages(accessToken);
        return {
          accountId,
          accountLabel,
          pages: result.pages.map((page) => ({
            id: page.id,
            name: page.name,
            hasInstagram: false,
            igAccountId: null,
            accountId,
            accountLabel,
          })),
          error: result.error,
        };
      }

      const boards = await fetchPinterestBoards(accessToken);
      return {
        accountId,
        accountLabel,
        pages: boards.pages.map((board: Record<string, unknown>) => ({
          ...board,
          accountId,
          accountLabel,
        })),
        error: boards.error,
      };
    }));

    const errors = fetched.map((result) => result.error).filter(Boolean);
    return apiOk({
      pages: dedupeById(fetched.flatMap((result) => result.pages)),
      linkedIds,
      accounts: fetched.map((result) => ({
        id: result.accountId,
        label: result.accountLabel,
        pageCount: result.pages.length,
      })),
      ...(errors.length ? { error: [...new Set(errors)].join(' ') } : {}),
    });
  } catch (error) {
    return apiError(error);
  }
}
