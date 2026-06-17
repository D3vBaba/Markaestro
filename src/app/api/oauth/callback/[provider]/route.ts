import { NextResponse } from 'next/server';
import { exchangeCode, storeTokens } from '@/lib/oauth/flow';
import { encrypt } from '@/lib/crypto';
import { oauthProviders, type OAuthProvider } from '@/lib/schemas';
import { getAppUrl } from '@/lib/oauth/config';
import { sanitizeAppReturnTo } from '@/lib/network-security';
import { logger } from '@/lib/logger';

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
  const data = await res.json().catch(() => ({} as Record<string, unknown>));

  if (!res.ok || !data.access_token) {
    // Capture the FULL Meta payload (no token is present on failures) so the
    // exact ig_exchange_token error is recoverable from Cloud Logging — this is
    // the durable-fix signal we can't reproduce without a live short-lived token.
    logger.error('instagram long-lived exchange failed', {
      event: 'oauth.instagram.long_lived.failed',
      httpStatus: res.status,
      body: JSON.stringify(data).slice(0, 1200),
      shortTokenLen: (tokens.accessToken || '').length,
    });
    throw new Error(`Instagram token exchange failed: ${data.error_message || data.error?.message || data.error || 'Unknown error'}`);
  }

  // Confirm we actually got a long-lived (~60d) token, not a passthrough.
  logger.info('instagram long-lived exchange ok', {
    event: 'oauth.instagram.long_lived.ok',
    expiresIn: data.expires_in ? Number(data.expires_in) : null,
    tokenType: typeof data.token_type === 'string' ? data.token_type : null,
  });

  return {
    accessToken: String(data.access_token),
    expiresIn: data.expires_in ? Number(data.expires_in) : tokens.expiresIn,
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

      // Persist the app-scoped user id so the deauthorize / data-deletion
      // webhooks can map a Meta "remove app" event back to this connection.
      try {
        const meRes = await fetch(
          `https://graph.facebook.com/v22.0/me?fields=id&access_token=${encodeURIComponent(tokens.accessToken)}`,
        );
        const meData = await meRes.json();
        if (meData.id) extraData.metaUserId = String(meData.id);
      } catch {
        // Non-fatal — webhook mapping just no-ops if the id is absent.
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

      // Exchange the short-lived token (~1h) for a long-lived one (~60d).
      // Best-effort: a failure here must NOT drop the whole connection — fall
      // back to the short-lived token so the account still links (this matches
      // the meta/threads branches, which already degrade gracefully). Without
      // this, any hiccup in ig_exchange_token left Instagram "unlinking itself"
      // because storeTokens never ran.
      try {
        const longLivedTokens = await exchangeInstagramToken(tokens);
        tokens.accessToken = longLivedTokens.accessToken;
        tokens.expiresIn = longLivedTokens.expiresIn;
      } catch (e) {
        console.warn('Instagram long-lived exchange failed:', e instanceof Error ? e.message : e);
      }

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

    // Every provider — including Meta — is linked per product. Each product
    // links its own Facebook login (no shared workspace-level Meta connection):
    // the user token + page metadata are stored together on the product doc.
    if (provider === 'meta' && !productId) {
      throw new Error('VALIDATION_MISSING_PRODUCT_ID');
    }
    await storeTokens(workspaceId, provider as OAuthProvider, tokens, userId, extraData, productId);

    const appUrl = getAppUrl();
    if (productId) {
      // Honor returnTo (e.g. the Settings → Integrations tab) so a per-product
      // connect returns where it started; default to the Products page.
      const base = (returnTo && sanitizeAppReturnTo(returnTo, appUrl)) || '/products';
      return redirectThroughBridge(appUrl, base, {
        oauth: 'success',
        provider,
        productId,
        ...(provider === 'meta' && metaNeedsPageSelection ? { needsPageSelect: '1' } : {}),
        ...(provider === 'pinterest' && pinterestNeedsBoardSelection ? { needsBoardSelect: '1' } : {}),
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
