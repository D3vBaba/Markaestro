import { NextResponse } from 'next/server';
import { exchangeCode, storeTokens } from '@/lib/oauth/flow';
import { encrypt } from '@/lib/crypto';
import { oauthProviders, type OAuthProvider } from '@/lib/schemas';
import { getConnectionRef } from '@/lib/platform/connections';
import { getAppUrl } from '@/lib/oauth/config';
import { sanitizeAppReturnTo } from '@/lib/network-security';

export const runtime = 'nodejs';


const ALLOWED = new Set<string>(oauthProviders);
const INSTAGRAM_GRAPH_API = 'https://graph.instagram.com/v25.0';

async function exchangeInstagramToken(tokens: {
  accessToken: string;
  expiresIn?: number;
}) {
  const appSecret = process.env.INSTAGRAM_APP_SECRET || '';
  if (!appSecret) {
    throw new Error('Missing OAuth credentials for instagram: INSTAGRAM_APP_SECRET');
  }

  const res = await fetch(
    `https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: appSecret,
      access_token: tokens.accessToken,
    }).toString()}`,
    { method: 'GET' },
  );
  const data = await res.json();

  if (!res.ok || !data.access_token) {
    throw new Error(`Instagram token exchange failed: ${data.error_message || data.error?.message || data.error || 'Unknown error'}`);
  }

  return {
    accessToken: String(data.access_token),
    expiresIn: data.expires_in ? Number(data.expires_in) : tokens.expiresIn,
  };
}

async function fetchLinkedInProfile(accessToken: string) {
  // OIDC userinfo endpoint — returns `sub` (LinkedIn member ID), name, email.
  // The `sub` value is the Person URN suffix: urn:li:person:{sub}.
  const res = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();

  if (!res.ok || !data.sub) {
    throw new Error(
      `LinkedIn profile fetch failed: ${data.error_description || data.error || data.message || 'Unknown error'}`,
    );
  }

  return {
    personId: String(data.sub),
    displayName: typeof data.name === 'string' ? data.name : '',
    email: typeof data.email === 'string' ? data.email : '',
    pictureUrl: typeof data.picture === 'string' ? data.picture : '',
  };
}

async function fetchTikTokProfile(accessToken: string) {
  const fields = [
    'open_id',
    'union_id',
    'avatar_url',
    'avatar_large_url',
    'display_name',
    'username',
    'bio_description',
    'profile_deep_link',
    'is_verified',
    'follower_count',
    'following_count',
    'likes_count',
    'video_count',
  ].join(',');

  const res = await fetch(`https://open.tiktokapis.com/v2/user/info/?fields=${fields}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();

  if (!res.ok || data.error?.code && data.error.code !== 'ok') {
    throw new Error(
      `TikTok profile fetch failed: ${data.error?.message || data.error?.code || 'Unknown error'}`,
    );
  }

  const user = data.data?.user as Record<string, unknown> | undefined;
  if (!user) {
    throw new Error('TikTok profile fetch failed: missing user');
  }

  return {
    openId: typeof user.open_id === 'string' ? user.open_id : '',
    unionId: typeof user.union_id === 'string' ? user.union_id : '',
    displayName: typeof user.display_name === 'string' ? user.display_name : '',
    username: typeof user.username === 'string' ? user.username : '',
    avatarUrl:
      (typeof user.avatar_large_url === 'string' && user.avatar_large_url) ||
      (typeof user.avatar_url === 'string' ? user.avatar_url : ''),
    bioDescription: typeof user.bio_description === 'string' ? user.bio_description : '',
    profileDeepLink: typeof user.profile_deep_link === 'string' ? user.profile_deep_link : '',
    isVerified: typeof user.is_verified === 'boolean' ? user.is_verified : false,
    followerCount: typeof user.follower_count === 'number' ? user.follower_count : 0,
    followingCount: typeof user.following_count === 'number' ? user.following_count : 0,
    likesCount: typeof user.likes_count === 'number' ? user.likes_count : 0,
    videoCount: typeof user.video_count === 'number' ? user.video_count : 0,
  };
}

async function fetchThreadsProfile(accessToken: string) {
  const res = await fetch(
    `https://graph.threads.net/v1.0/me?${new URLSearchParams({
      fields: 'id,username,name,threads_profile_picture_url',
      access_token: accessToken,
    }).toString()}`,
  );
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(`Threads profile fetch failed: ${data.error?.message || data.error_message || 'Unknown error'}`);
  }
  return {
    threadsUserId: String(data.id),
    username: typeof data.username === 'string' ? data.username : '',
    displayName: typeof data.name === 'string' ? data.name : (typeof data.username === 'string' ? data.username : ''),
    pictureUrl: typeof data.threads_profile_picture_url === 'string' ? data.threads_profile_picture_url : '',
  };
}

async function exchangeThreadsLongLivedToken(shortToken: string) {
  const appSecret = process.env.THREADS_APP_SECRET || '';
  if (!appSecret) {
    throw new Error('Missing OAuth credentials for threads: THREADS_APP_SECRET');
  }
  const res = await fetch(
    `https://graph.threads.net/access_token?${new URLSearchParams({
      grant_type: 'th_exchange_token',
      client_secret: appSecret,
      access_token: shortToken,
    }).toString()}`,
  );
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Threads long-lived token exchange failed: ${data.error_message || data.error || 'Unknown error'}`);
  }
  return {
    accessToken: String(data.access_token),
    expiresIn: data.expires_in ? Number(data.expires_in) : undefined,
  };
}

async function fetchPinterestProfile(accessToken: string) {
  const res = await fetch('https://api.pinterest.com/v5/user_account', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Pinterest profile fetch failed: ${data.message || 'Unknown error'}`);
  }
  return {
    username: typeof data.username === 'string' ? data.username : '',
    displayName: typeof data.username === 'string' ? data.username : 'Pinterest',
    accountType: typeof data.account_type === 'string' ? data.account_type : '',
    profileImage: typeof data.profile_image === 'string' ? data.profile_image : '',
  };
}

async function fetchYouTubeProfile(accessToken: string) {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?${new URLSearchParams({
      part: 'id,snippet',
      mine: 'true',
    }).toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`YouTube channel fetch failed: ${data.error?.message || 'Unknown error'}`);
  }
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    channels: items.map((item: Record<string, unknown>) => {
      const snippet = (item.snippet || {}) as Record<string, unknown>;
      const thumbnails = (snippet.thumbnails || {}) as Record<string, unknown>;
      const defaultThumb = (thumbnails.default || thumbnails.medium || thumbnails.high || {}) as Record<string, unknown>;
      return {
        id: String(item.id),
        title: typeof snippet.title === 'string' ? snippet.title : '',
        description: typeof snippet.description === 'string' ? snippet.description : '',
        thumbnailUrl: typeof defaultThumb.url === 'string' ? defaultThumb.url : '',
      };
    }),
  };
}

async function fetchXProfile(accessToken: string) {
  const res = await fetch(
    'https://api.twitter.com/2/users/me?user.fields=id,name,username,profile_image_url,verified',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await res.json();
  if (!res.ok || !data.data?.id) {
    throw new Error(`X profile fetch failed: ${data.detail || data.title || data.error || 'Unknown error'}`);
  }
  const user = data.data;
  return {
    userId: String(user.id),
    username: typeof user.username === 'string' ? user.username : '',
    displayName: typeof user.name === 'string' ? user.name : (typeof user.username === 'string' ? user.username : 'X'),
    pictureUrl: typeof user.profile_image_url === 'string' ? user.profile_image_url : '',
    verified: Boolean(user.verified),
  };
}

async function fetchInstagramProfile(accessToken: string) {
  const res = await fetch(
    `${INSTAGRAM_GRAPH_API}/me?${new URLSearchParams({
      fields: 'user_id,username',
      access_token: accessToken,
    }).toString()}`,
  );
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Instagram profile fetch failed: ${data.error?.message || data.error_message || 'Unknown error'}`);
  }

  const userId = typeof data.user_id === 'string' ? data.user_id : typeof data.id === 'string' ? data.id : '';
  if (!userId) {
    throw new Error('Instagram profile fetch failed: missing user id');
  }

  return {
    userId,
    username: typeof data.username === 'string' ? data.username : '',
  };
}

function redirectWithParams(
  appUrl: string,
  pathOrRelativeUrl: string,
  params: Record<string, string>,
) {
  const redirectUrl = new URL(pathOrRelativeUrl, appUrl);
  for (const [key, value] of Object.entries(params)) {
    redirectUrl.searchParams.set(key, value);
  }
  return NextResponse.redirect(redirectUrl.toString());
}

function buildRelativeUrl(
  appUrl: string,
  pathOrRelativeUrl: string,
  params: Record<string, string>,
) {
  const redirectUrl = new URL(pathOrRelativeUrl, appUrl);
  for (const [key, value] of Object.entries(params)) {
    redirectUrl.searchParams.set(key, value);
  }

  return `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`;
}

function redirectThroughBridge(
  appUrl: string,
  pathOrRelativeUrl: string,
  params: Record<string, string>,
) {
  return redirectWithParams(appUrl, '/oauth/complete', {
    next: buildRelativeUrl(appUrl, pathOrRelativeUrl, params),
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    if (!ALLOWED.has(provider)) {
      throw new Error('INVALID_PROVIDER');
    }

    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const errorParam = url.searchParams.get('error');

    if (errorParam) {
      const desc = url.searchParams.get('error_description') || errorParam;
      const appUrl = getAppUrl();
      return redirectThroughBridge(appUrl, '/settings', {
        oauth: 'error',
        provider,
        message: desc,
      });
    }

    if (!code || !state) {
      // Browser preload/crawler hits /callback/{provider} without any params.
      // Respond with a plain 400 so we don't log a spurious OAuth error and
      // don't consume a valid state document.
      return new NextResponse('Missing code or state', { status: 400 });
    }

    const exchangeResult = await exchangeCode(
      provider as OAuthProvider,
      code,
      state,
    );
    const { tokens, workspaceId, userId, productId, returnTo } = exchangeResult;

    const extraData: Record<string, unknown> = {};
    let metaNeedsPageSelection = false;

    if (exchangeResult.extraData) {
      Object.assign(extraData, exchangeResult.extraData);
    }

    // Provider-specific post-processing
    if (provider === 'meta') {
      extraData.pageSelectionRequired = false;
      // Exchange short-lived token for long-lived token (60 days)
      // This is critical — without it the token expires in ~1-2 hours
      try {
        const llRes = await fetch(
          `https://graph.facebook.com/v22.0/oauth/access_token?` +
          new URLSearchParams({
            grant_type: 'fb_exchange_token',
            client_id: process.env.META_APP_ID || '',
            client_secret: process.env.META_APP_SECRET || '',
            fb_exchange_token: tokens.accessToken,
          }).toString(),
        );
        const llData = await llRes.json();
        if (llData.access_token) {
          tokens.accessToken = llData.access_token;
          // Long-lived tokens last ~60 days
          tokens.expiresIn = llData.expires_in ? Number(llData.expires_in) : 60 * 24 * 60 * 60;
        }
      } catch {
        // Continue with short-lived token if exchange fails
      }

      // Fetch user's pages for later selection
      try {
        const pagesRes = await fetch(
          `https://graph.facebook.com/v22.0/me/accounts?fields=id,name,access_token,instagram_business_account`,
          { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
        );
        const pagesData = await pagesRes.json();
        if (pagesData.data && pagesData.data.length > 0) {
          // Store pages metadata (without tokens) for the page selector
          extraData.availablePages = pagesData.data.map((p: Record<string, unknown>) => ({
            id: p.id,
            name: p.name,
            hasIg: Boolean(p.instagram_business_account),
          }));
          if (pagesData.data.length === 1) {
            const page = pagesData.data[0] as Record<string, unknown>;
            extraData.pageId = page.id;
            extraData.pageName = page.name;
            extraData.pageAccessTokenEncrypted = encrypt(page.access_token as string);
            extraData.pageSelectionRequired = false;
            if ((page.instagram_business_account as Record<string, unknown> | undefined)?.id) {
              extraData.igAccountId = (page.instagram_business_account as Record<string, unknown>).id;
            }
          } else {
            metaNeedsPageSelection = true;
            extraData.pageSelectionRequired = true;
          }
        }
      } catch {
        // Non-fatal — user can still select pages later
      }
    }

    if (provider === 'instagram') {
      if (!productId) {
        throw new Error('VALIDATION_MISSING_PRODUCT_ID');
      }

      const longLivedTokens = await exchangeInstagramToken(tokens);
      tokens.accessToken = longLivedTokens.accessToken;
      tokens.expiresIn = longLivedTokens.expiresIn;

      const profile = await fetchInstagramProfile(tokens.accessToken);
      extraData.igAccountId = profile.userId;
      extraData.username = profile.username;
      extraData.displayName = profile.username || 'Instagram';
      extraData.loginType = 'instagram_login';
    }

    if (provider === 'tiktok') {
      // TikTok returns open_id in the token response
      if (tokens.openId) {
        extraData.openId = tokens.openId;
      }

      // Fetch profile using the newly-approved user.info.profile + user.info.stats scopes
      // so the connection metadata reflects the creator's identity and current stats.
      try {
        const profile = await fetchTikTokProfile(tokens.accessToken);
        if (profile.openId) extraData.openId = profile.openId;
        if (profile.unionId) extraData.unionId = profile.unionId;
        if (profile.displayName) extraData.displayName = profile.displayName;
        if (profile.username) extraData.username = profile.username;
        if (profile.avatarUrl) extraData.avatarUrl = profile.avatarUrl;
        if (profile.bioDescription) extraData.bioDescription = profile.bioDescription;
        if (profile.profileDeepLink) extraData.profileDeepLink = profile.profileDeepLink;
        extraData.isVerified = profile.isVerified;
        extraData.followerCount = profile.followerCount;
        extraData.followingCount = profile.followingCount;
        extraData.likesCount = profile.likesCount;
        extraData.videoCount = profile.videoCount;
      } catch (e) {
        // Non-fatal — insights endpoint will re-fetch on demand
        console.warn('TikTok profile fetch failed:', e instanceof Error ? e.message : e);
      }
    }

    if (provider === 'linkedin') {
      // LinkedIn doesn't return the person URN in the token response — fetch it via
      // OIDC userinfo. The `sub` field becomes urn:li:person:{sub}, which we use as
      // the `author` when publishing via /rest/posts.
      const profile = await fetchLinkedInProfile(tokens.accessToken);
      extraData.authorType = 'person';
      extraData.authorUrn = `urn:li:person:${profile.personId}`;
      extraData.personId = profile.personId;
      extraData.displayName = profile.displayName || 'LinkedIn';
      if (profile.email) extraData.email = profile.email;
      if (profile.pictureUrl) extraData.pictureUrl = profile.pictureUrl;
    }

    let youtubeNeedsChannelSelection = false;
    let pinterestNeedsBoardSelection = false;

    if (provider === 'threads') {
      if (!productId) {
        throw new Error('VALIDATION_MISSING_PRODUCT_ID');
      }
      // Exchange the short-lived token (~1h) for a long-lived token (~60d).
      // Without this, the connection expires before most scheduled posts land.
      try {
        const longLived = await exchangeThreadsLongLivedToken(tokens.accessToken);
        tokens.accessToken = longLived.accessToken;
        if (longLived.expiresIn) tokens.expiresIn = longLived.expiresIn;
      } catch (e) {
        console.warn('Threads long-lived exchange failed:', e instanceof Error ? e.message : e);
      }
      const profile = await fetchThreadsProfile(tokens.accessToken);
      extraData.threadsUserId = profile.threadsUserId;
      extraData.username = profile.username;
      extraData.displayName = profile.displayName || profile.username || 'Threads';
      if (profile.pictureUrl) extraData.pictureUrl = profile.pictureUrl;
    }

    if (provider === 'pinterest') {
      if (!productId) {
        throw new Error('VALIDATION_MISSING_PRODUCT_ID');
      }
      const profile = await fetchPinterestProfile(tokens.accessToken);
      extraData.username = profile.username;
      extraData.displayName = profile.displayName;
      if (profile.profileImage) extraData.pictureUrl = profile.profileImage;
      if (profile.accountType) extraData.accountType = profile.accountType;
      // Board picker runs after this callback. Flag the connection as needing
      // selection so the UI can prompt the user.
      extraData.boardSelectionRequired = true;
      pinterestNeedsBoardSelection = true;
    }

    if (provider === 'youtube') {
      if (!productId) {
        throw new Error('VALIDATION_MISSING_PRODUCT_ID');
      }
      const profile = await fetchYouTubeProfile(tokens.accessToken);
      if (profile.channels.length === 1) {
        const channel = profile.channels[0];
        extraData.channelId = channel.id;
        extraData.channelTitle = channel.title;
        if (channel.thumbnailUrl) extraData.pictureUrl = channel.thumbnailUrl;
        extraData.displayName = channel.title || 'YouTube';
        extraData.channelSelectionRequired = false;
      } else if (profile.channels.length > 1) {
        extraData.availableChannels = profile.channels;
        extraData.channelSelectionRequired = true;
        youtubeNeedsChannelSelection = true;
        extraData.displayName = 'YouTube';
      } else {
        throw new Error('No YouTube channel found on this Google account');
      }
    }

    if (provider === 'x') {
      if (!productId) {
        throw new Error('VALIDATION_MISSING_PRODUCT_ID');
      }
      const profile = await fetchXProfile(tokens.accessToken);
      extraData.userId = profile.userId;
      extraData.username = profile.username;
      extraData.displayName = profile.displayName;
      if (profile.pictureUrl) extraData.pictureUrl = profile.pictureUrl;
      extraData.verified = profile.verified;
    }

    // Meta: store user token at workspace level (not per-product)
    if (provider === 'meta') {
      // Store workspace-level user token (without productId)
      await storeTokens(workspaceId, 'meta', tokens, userId, extraData);

      // If exactly 1 page AND productId in state: also write page selection to product-level doc
      if (productId && !metaNeedsPageSelection && extraData.pageId) {
        const prodRef = getConnectionRef(workspaceId, 'meta', productId);
        await prodRef.set({
          provider: 'meta',
          status: 'connected',
          metadata: {
            pageId: extraData.pageId,
            pageName: extraData.pageName,
            pageAccessTokenEncrypted: extraData.pageAccessTokenEncrypted,
            igAccountId: extraData.igAccountId || null,
            pageSelectionRequired: false,
          },
          workspaceId,
          productId,
          updatedBy: userId,
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        }, { merge: true });
      }
    } else {
      await storeTokens(workspaceId, provider as OAuthProvider, tokens, userId, extraData, productId);
    }

    const appUrl = getAppUrl();
    if (productId) {
      return redirectThroughBridge(appUrl, '/products', {
        oauth: 'success',
        provider,
        productId,
        ...(provider === 'meta' && metaNeedsPageSelection ? { needsPageSelect: '1' } : {}),
        ...(provider === 'pinterest' && pinterestNeedsBoardSelection ? { needsBoardSelect: '1' } : {}),
        ...(provider === 'youtube' && youtubeNeedsChannelSelection ? { needsChannelSelect: '1' } : {}),
      });
    }
    const successBase = returnTo
      ? sanitizeAppReturnTo(returnTo, appUrl) ?? '/settings'
      : '/settings';
    return redirectThroughBridge(appUrl, successBase, {
      oauth: 'success',
      provider,
    });
  } catch (error) {
    console.error('OAuth callback error:', error);
    const appUrl = getAppUrl();
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const providerParam = (await params).provider;
    // For social providers the error state doesn't carry productId (it was in the state doc),
    // so redirect to settings as a safe fallback
    return redirectThroughBridge(appUrl, '/settings', {
      oauth: 'error',
      provider: providerParam,
      message: msg,
    });
  }
}
