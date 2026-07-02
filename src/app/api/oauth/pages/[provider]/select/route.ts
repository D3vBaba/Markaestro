import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { encrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { getConnection, resolveUserAccessToken, getConnectionRef } from '@/lib/platform/connections';
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

export const runtime = 'nodejs';


export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'integrations.manage');

    const { provider } = await params;
    if (provider !== 'meta' && provider !== 'pinterest' && provider !== 'linkedin') {
      throw new Error('INVALID_PROVIDER');
    }

    const { pageId, pageName, productId } = await req.json();
    if (!pageId) {
      throw new Error('VALIDATION_MISSING_PAGE_ID');
    }

    if (provider === 'pinterest') {
      if (!productId) throw new Error('VALIDATION_MISSING_PRODUCT_ID');
      const connRef = getConnectionRef(ctx.workspaceId, provider, productId);
      const snap = await connRef.get();
      if (!snap.exists) throw new Error('NOT_FOUND');
      const connection = snap.data() as PlatformConnection;
      const accessToken = resolveUserAccessToken(connection);

      const boardsRes = await fetch('https://api.pinterest.com/v5/boards?page_size=100', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const boardsData = await boardsRes.json();
      if (!boardsRes.ok || !Array.isArray(boardsData.items)) {
        throw new Error(boardsData.message || 'Failed to verify Pinterest board');
      }
      const selectedBoard = boardsData.items.find((board: Record<string, unknown>) => String(board.id) === String(pageId));
      if (!selectedBoard) {
        throw new Error('NOT_FOUND');
      }

      await connRef.update({
        'metadata.boardId': pageId,
        'metadata.boardName': pageName || String(selectedBoard.name ?? ''),
        'metadata.boardSelectionRequired': false,
        updatedAt: new Date().toISOString(),
        updatedBy: ctx.uid,
      });

      return apiOk({ ok: true, id: pageId, name: pageName || String(selectedBoard.name ?? '') });
    }

    if (provider === 'linkedin') {
      if (!productId) throw new Error('VALIDATION_MISSING_PRODUCT_ID');
      const refs = [
        getConnectionRef(ctx.workspaceId, LINKEDIN_PROFILE_PROVIDER, productId),
        getConnectionRef(ctx.workspaceId, LINKEDIN_COMMUNITY_PROVIDER, productId),
        getConnectionRef(ctx.workspaceId, 'linkedin', productId),
      ];
      const snaps = await Promise.all(refs.map((ref) => ref.get()));
      const candidates: Array<{
        ref: FirebaseFirestore.DocumentReference;
        connection: PlatformConnection;
        destinations: LinkedInDestination[];
      }> = [];

      for (let i = 0; i < snaps.length; i++) {
        const snap = snaps[i];
        if (!snap.exists) continue;
        const connection = snap.data() as PlatformConnection;
        if (!connection.accessTokenEncrypted) continue;
        const accessToken = resolveUserAccessToken(connection);
        let destinations = getStoredLinkedInDestinations(connection);

        try {
          if (connection.provider === LINKEDIN_PROFILE_PROVIDER) {
            const profile = await fetchLinkedInProfile(accessToken);
            destinations = [profile];
            await refs[i].update({
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
          } else if (connection.provider === LINKEDIN_COMMUNITY_PROVIDER) {
            const discovery = await discoverLinkedInDestinations(accessToken, connection.metadata.oauthScopes || connection.metadata.linkedinScopes);
            destinations = discovery.pages;
            await refs[i].update({
              'metadata.linkedinCredentialKind': 'community',
              'metadata.linkedinAuthorizingProfileId': discovery.profile.id,
              'metadata.linkedinAuthorizingProfileUrn': discovery.profile.urn,
              'metadata.linkedinAuthorizingProfileName': discovery.profile.name,
              'metadata.linkedinAuthorizingProfilePictureUrl': discovery.profile.pictureUrl || null,
              'metadata.linkedinPages': discovery.pages,
              'metadata.linkedinScopes': parseLinkedInScopes(connection.metadata.oauthScopes || connection.metadata.linkedinScopes),
              'metadata.linkedinPageDiscoveryError': discovery.pageDiscoveryError || null,
              updatedAt: new Date().toISOString(),
            });
          } else {
            const discovery = await discoverLinkedInDestinations(accessToken, connection.metadata.oauthScopes || connection.metadata.linkedinScopes);
            destinations = [discovery.profile, ...discovery.pages];
            await refs[i].update({
              'metadata.linkedinProfileId': discovery.profile.id,
              'metadata.linkedinProfileUrn': discovery.profile.urn,
              'metadata.linkedinProfileName': discovery.profile.name,
              'metadata.linkedinProfilePictureUrl': discovery.profile.pictureUrl || null,
              'metadata.linkedinPages': discovery.pages,
              'metadata.linkedinPageDiscoveryError': discovery.pageDiscoveryError || null,
              updatedAt: new Date().toISOString(),
            });
          }
        } catch {
          // Use stored metadata if live discovery is temporarily unavailable.
        }

        candidates.push({ ref: refs[i], connection, destinations });
      }

      const selected = candidates
        .map((candidate) => ({
          candidate,
          destination: candidate.destinations.find((destination) =>
            destination.urn === String(pageId) ||
            destination.id === String(pageId) ||
            `linkedin:linkedin:${destination.id}` === String(pageId)
          ) || null,
        }))
        .find((entry) => entry.destination);

      if (!selected?.destination) {
        throw new Error('NOT_FOUND');
      }

      const selectedDestination = selected.destination;
      const now = new Date().toISOString();
      await Promise.all(candidates.map(({ ref }) => {
        if (ref.path === selected.candidate.ref.path) {
          return ref.update({
            'metadata.linkedinDestinationUrn': selectedDestination.urn,
            'metadata.linkedinDestinationType': selectedDestination.type,
            'metadata.linkedinDestinationName': pageName || selectedDestination.name,
            'metadata.linkedinDestinationAccountId': selectedDestination.id,
            'metadata.linkedinDestinationSelectionRequired': false,
            updatedAt: now,
            updatedBy: ctx.uid,
          });
        }
        return ref.update({
          'metadata.linkedinDestinationUrn': null,
          'metadata.linkedinDestinationType': null,
          'metadata.linkedinDestinationName': null,
          'metadata.linkedinDestinationAccountId': null,
          'metadata.linkedinDestinationSelectionRequired': false,
          updatedAt: now,
          updatedBy: ctx.uid,
        });
      }));

      return apiOk({
        ok: true,
        id: selectedDestination.urn,
        name: pageName || selectedDestination.name,
        type: selectedDestination.type,
      });
    }

    // Per-product Meta: the user token lives on the product's own connection.
    if (!productId) throw new Error('VALIDATION_MISSING_PRODUCT_ID');
    const prodConn = await getConnection(ctx.workspaceId, 'meta', productId);
    if (!prodConn) throw new Error('NOT_FOUND');
    const userAccessToken = resolveUserAccessToken(prodConn);

    // Fetch pages to get the selected page's access token
    const pagesRes = await fetch(
      'https://graph.facebook.com/v22.0/me/accounts?fields=id,name,access_token,instagram_business_account',
      { headers: { Authorization: `Bearer ${userAccessToken}` } },
    );
    const pagesData = await pagesRes.json();

    if (!pagesRes.ok || !pagesData.data) {
      throw new Error('Failed to fetch pages from Meta');
    }

    const selectedPage = pagesData.data.find((p: Record<string, unknown>) => p.id === pageId);
    if (!selectedPage) {
      throw new Error('NOT_FOUND');
    }

    // Merge the chosen page onto the product's Meta connection (the user token
    // already on the doc is preserved).
    const prodRef = getConnectionRef(ctx.workspaceId, 'meta', productId);
    await prodRef.set({
      provider: 'meta',
      status: 'connected',
      metadata: {
        pageId,
        pageName: pageName || selectedPage.name,
        pageAccessTokenEncrypted: encrypt(selectedPage.access_token as string),
        igAccountId: selectedPage.instagram_business_account?.id || null,
        pageSelectionRequired: false,
      },
      workspaceId: ctx.workspaceId,
      productId,
      updatedBy: ctx.uid,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    return apiOk({
      ok: true,
      pageId,
      pageName: pageName || selectedPage.name,
      igAccountId: selectedPage.instagram_business_account?.id || null,
    });
  } catch (error) {
    return apiError(error);
  }
}
