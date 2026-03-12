import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { exchangeCode, storeTokens } from '@/lib/oauth/flow';
import { oauthProviders, type OAuthProvider } from '@/lib/schemas';

const ALLOWED = new Set<string>(oauthProviders);

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
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      return NextResponse.redirect(
        `${appUrl}/settings?oauth=error&provider=${provider}&message=${encodeURIComponent(desc)}`,
      );
    }

    if (!code || !state) {
      throw new Error('INVALID_STATE');
    }

    const { tokens, workspaceId, userId, productId } = await exchangeCode(
      provider as OAuthProvider,
      code,
      state,
    );

    const extraData: Record<string, unknown> = {};

    // Provider-specific post-processing
    if (provider === 'meta') {
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

    if (provider === 'x') {
      // Fetch X username for display and tweet URLs
      try {
        const meRes = await fetch('https://api.x.com/2/users/me', {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
        const meData = await meRes.json();
        if (meData.data?.username) {
          extraData.username = meData.data.username;
        }
      } catch (e) {
        console.error('Failed to fetch X username:', e);
      }
    }

    await storeTokens(workspaceId, provider as OAuthProvider, tokens, userId, extraData, productId);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    if (productId) {
      return NextResponse.redirect(`${appUrl}/products?oauth=success&provider=${provider}&productId=${productId}`);
    }
    return NextResponse.redirect(`${appUrl}/settings?oauth=success&provider=${provider}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const providerParam = (await params).provider;
    // For social providers the error state doesn't carry productId (it was in the state doc),
    // so redirect to settings as a safe fallback
    return NextResponse.redirect(
      `${appUrl}/settings?oauth=error&provider=${providerParam}&message=${encodeURIComponent(msg)}`,
    );
  }
}
