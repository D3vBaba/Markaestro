import { NextResponse } from 'next/server';
import { exchangeCode, storeTokens } from '@/lib/oauth/flow';
import { encrypt } from '@/lib/crypto';
import { oauthProviders, type OAuthProvider } from '@/lib/schemas';
import { getConnectionRef } from '@/lib/platform/connections';
import { getAppUrl } from '@/lib/oauth/config';

const ALLOWED = new Set<string>(oauthProviders);

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    if (!ALLOWED.has(provider)) {
      throw new Error('INVALID_PROVIDER');
    }

    const url = new URL(req.url);
    // TikTok Marketing API uses 'auth_code' instead of 'code'
    const code = url.searchParams.get('auth_code') || url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const errorParam = url.searchParams.get('error');

    if (errorParam) {
      const desc = url.searchParams.get('error_description') || errorParam;
      const appUrl = getAppUrl();
      return NextResponse.redirect(
        `${appUrl}/settings?oauth=error&provider=${provider}&message=${encodeURIComponent(desc)}`,
      );
    }

    if (!code || !state) {
      throw new Error('INVALID_STATE');
    }

    const exchangeResult = await exchangeCode(
      provider as OAuthProvider,
      code,
      state,
    );
    const { tokens, workspaceId, userId, productId } = exchangeResult;

    const extraData: Record<string, unknown> = {};
    let metaNeedsPageSelection = false;

    // TikTok Ads: merge extraData from token exchange (advertiserId, etc.)
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

    if (provider === 'tiktok') {
      // TikTok returns open_id in the token response
      if (tokens.openId) {
        extraData.openId = tokens.openId;
      }
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
      const params = new URLSearchParams({
        oauth: 'success',
        provider,
        productId,
      });
      if (provider === 'meta' && metaNeedsPageSelection) {
        params.set('needsPageSelect', '1');
      }
      return NextResponse.redirect(`${appUrl}/products?${params.toString()}`);
    }
    return NextResponse.redirect(`${appUrl}/settings?oauth=success&provider=${provider}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    const appUrl = getAppUrl();
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const providerParam = (await params).provider;
    // For social providers the error state doesn't carry productId (it was in the state doc),
    // so redirect to settings as a safe fallback
    return NextResponse.redirect(
      `${appUrl}/settings?oauth=error&provider=${providerParam}&message=${encodeURIComponent(msg)}`,
    );
  }
}
