export type PinterestApiEnvironment = 'production' | 'sandbox';

const PINTEREST_API_ORIGINS: Record<PinterestApiEnvironment, string> = {
  production: 'https://api.pinterest.com',
  sandbox: 'https://api-sandbox.pinterest.com',
};

/**
 * Pinterest Trial apps must use API Sandbox for write operations. Keep the
 * environment server-controlled so tokens, boards, and Pins never get mixed
 * between Sandbox and production.
 */
export function getPinterestApiEnvironment(): PinterestApiEnvironment {
  const value = process.env.PINTEREST_API_ENVIRONMENT?.trim().toLowerCase();
  if (!value || value === 'production') return 'production';
  if (value === 'sandbox') return 'sandbox';
  throw new Error('PINTEREST_API_ENVIRONMENT must be "sandbox" or "production"');
}

export function isPinterestSandbox(): boolean {
  return getPinterestApiEnvironment() === 'sandbox';
}

export function getPinterestApiUrl(path = ''): string {
  const normalizedPath = path && !path.startsWith('/') ? `/${path}` : path;
  return `${PINTEREST_API_ORIGINS[getPinterestApiEnvironment()]}/v5${normalizedPath}`;
}
