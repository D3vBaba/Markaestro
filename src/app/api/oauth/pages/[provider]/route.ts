import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { getConnection, getConnectionRef, resolveUserAccessToken } from '@/lib/platform/connections';
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

export const runtime = 'nodejs';


async function fetchMetaPages(accessToken: string) {
  const res = await fetch(
    'https://graph.facebook.com/v22.0/me/accounts?fields=id,name,access_token,instagram_business_account',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await res.json();
  if (!res.ok || !data.data) {
    return { pages: [], error: data.error?.message || 'Failed to fetch pages' };
  }
  return {
    pages: data.data.map((p: Record<string, unknown>) => ({
      id: p.id,
      name: p.name,
      hasInstagram: Boolean(p.instagram_business_account),
      igAccountId: (p.instagram_business_account as Record<string, string>)?.id || null,
    })),
  };
}

async function fetchPinterestBoards(accessToken: string) {
  const res = await fetch('https://api.pinterest.com/v5/boards?page_size=100', {
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

    if (provider === 'linkedin') {
      const [profileConn, communityConn, legacyConn] = await Promise.all([
        getConnection(ctx.workspaceId, LINKEDIN_PROFILE_PROVIDER, productId),
        getConnection(ctx.workspaceId, LINKEDIN_COMMUNITY_PROVIDER, productId),
        getConnection(ctx.workspaceId, 'linkedin', productId),
      ]);
      const profileRef = getConnectionRef(ctx.workspaceId, LINKEDIN_PROFILE_PROVIDER, productId);
      const communityRef = getConnectionRef(ctx.workspaceId, LINKEDIN_COMMUNITY_PROVIDER, productId);
      const [profileResult, communityResult] = await Promise.all([
        fetchLinkedInProfileDestinations(profileConn, profileRef),
        fetchLinkedInCommunityDestinations(communityConn, communityRef),
      ]);
      const legacyResult = !profileConn && !communityConn && legacyConn?.accessTokenEncrypted
        ? await fetchLinkedInDestinations(resolveUserAccessToken(legacyConn), legacyConn)
        : { pages: [] };
      const pages = [...profileResult.pages, ...communityResult.pages, ...legacyResult.pages];
      const errors = [profileResult.error, communityResult.error, legacyResult.error].filter(Boolean);
      return apiOk({
        pages,
        ...(errors.length ? { error: errors.join(' ') } : {}),
      });
    }

    // Every provider — including Meta — is linked per product, so the OAuth
    // tokens live on the product-level connection doc.
    const conn = await getConnection(ctx.workspaceId, provider, productId);

    if (!conn || !conn.accessTokenEncrypted) {
      return apiOk({ pages: [] });
    }

    const accessToken = resolveUserAccessToken(conn);

    if (provider === 'meta') {
      return apiOk(await fetchMetaPages(accessToken));
    }
    return apiOk(await fetchPinterestBoards(accessToken));
  } catch (error) {
    return apiError(error);
  }
}
