import { NextResponse } from 'next/server';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { generateAuthUrl } from '@/lib/oauth/flow';
import { getAppUrl } from '@/lib/oauth/config';
import { oauthProviders, type OAuthProvider } from '@/lib/schemas';
import { sanitizeAppReturnTo } from '@/lib/network-security';

const ALLOWED = new Set<string>(oauthProviders);
const SOCIAL_PROVIDERS = new Set(['instagram', 'tiktok', 'linkedin']);

function getFallbackPath(productId?: string, returnTo?: string) {
  if (productId) return '/products';
  if (returnTo) return returnTo;
  return '/settings';
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

function parseAuthorizeInput(req: Request, body: Record<string, unknown>) {
  const url = new URL(req.url);
  const productId =
    (typeof body.productId === 'string' ? body.productId : null) ||
    url.searchParams.get('productId') ||
    undefined;
  const rawReturnTo =
    (typeof body.returnTo === 'string' ? body.returnTo : null) ||
    url.searchParams.get('returnTo') ||
    undefined;

  return { productId, rawReturnTo };
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'integrations.manage');

    const { provider } = await params;
    if (!ALLOWED.has(provider)) {
      throw new Error('INVALID_PROVIDER');
    }

    const body = await req.json().catch(() => ({}));
    const { productId, rawReturnTo } = parseAuthorizeInput(req, body);
    const returnTo = rawReturnTo
      ? sanitizeAppReturnTo(rawReturnTo, getAppUrl()) ?? undefined
      : undefined;

    if (rawReturnTo && !returnTo) {
      throw new Error('VALIDATION_INVALID_RETURN_TO');
    }

    // Social providers require a productId (per-product integrations)
    if (SOCIAL_PROVIDERS.has(provider) && !productId) {
      throw new Error('VALIDATION_MISSING_PRODUCT_ID');
    }

    const authUrl = await generateAuthUrl(
      provider as OAuthProvider,
      ctx.workspaceId,
      ctx.uid,
      productId,
      returnTo,
    );

    return apiOk({ authUrl });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  let provider = '';
  let fallbackPath = '/settings';

  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'integrations.manage');

    const routeParams = await params;
    provider = routeParams.provider;
    if (!ALLOWED.has(provider)) {
      throw new Error('INVALID_PROVIDER');
    }

    const { productId, rawReturnTo } = parseAuthorizeInput(req, {});
    const returnTo = rawReturnTo
      ? sanitizeAppReturnTo(rawReturnTo, getAppUrl()) ?? undefined
      : undefined;
    fallbackPath = getFallbackPath(productId, returnTo);

    if (rawReturnTo && !returnTo) {
      throw new Error('VALIDATION_INVALID_RETURN_TO');
    }

    if (SOCIAL_PROVIDERS.has(provider) && !productId) {
      throw new Error('VALIDATION_MISSING_PRODUCT_ID');
    }

    const authUrl = await generateAuthUrl(
      provider as OAuthProvider,
      ctx.workspaceId,
      ctx.uid,
      productId,
      returnTo,
    );

    return NextResponse.redirect(authUrl);
  } catch (error) {
    const appUrl = getAppUrl();
    const message = error instanceof Error ? error.message : 'Unknown error';
    return redirectWithParams(appUrl, fallbackPath, {
      oauth: 'error',
      provider: provider || 'unknown',
      message,
    });
  }
}
