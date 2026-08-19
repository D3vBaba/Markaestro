import { logger } from '@/lib/logger';

export type PinterestApiEnvironment = 'production' | 'sandbox';

const PINTEREST_API_ORIGINS: Record<PinterestApiEnvironment, string> = {
  production: 'https://api.pinterest.com',
  sandbox: 'https://api-sandbox.pinterest.com',
};

/**
 * Sandbox is a local-development affordance only.
 *
 * The app holds Standard access, so every deployed runtime must talk to the
 * production API. Sandbox and production are fully separate worlds: a token
 * minted at api-sandbox.pinterest.com is rejected by api.pinterest.com (and
 * vice versa), Sandbox board ids 404 in production, and Sandbox Pins are
 * visible only to their creator. A deployed backend that reached Sandbox would
 * silently publish Pins nobody can see, so `sandbox` is refused there outright
 * rather than trusted from configuration.
 *
 * App Hosting builds and runs the server with NODE_ENV=production, so that is
 * the deployment signal; `next dev`, `vitest`, and scripts run outside it.
 */
function isDeployedRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

let deployedSandboxRequestLogged = false;

export function getPinterestApiEnvironment(): PinterestApiEnvironment {
  const value = process.env.PINTEREST_API_ENVIRONMENT?.trim().toLowerCase();
  if (!value || value === 'production') return 'production';
  if (value !== 'sandbox') {
    throw new Error('PINTEREST_API_ENVIRONMENT must be "sandbox" or "production"');
  }
  if (isDeployedRuntime()) {
    // Stay on production rather than throwing: publishing keeps working and the
    // misconfiguration is loud in Cloud Logging instead of breaking the channel.
    if (!deployedSandboxRequestLogged) {
      deployedSandboxRequestLogged = true;
      logger.error('Ignoring PINTEREST_API_ENVIRONMENT=sandbox on a deployed runtime', {
        event: 'pinterest.sandbox_override_refused',
        resolvedEnvironment: 'production',
      });
    }
    return 'production';
  }
  return 'sandbox';
}

export function isPinterestSandbox(): boolean {
  return getPinterestApiEnvironment() === 'sandbox';
}

export function getPinterestApiUrl(path = ''): string {
  const normalizedPath = path && !path.startsWith('/') ? `/${path}` : path;
  return `${PINTEREST_API_ORIGINS[getPinterestApiEnvironment()]}/v5${normalizedPath}`;
}
