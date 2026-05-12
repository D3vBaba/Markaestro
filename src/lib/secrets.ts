/**
 * Google Cloud Secret Manager client.
 *
 * Fetches secrets by name, caches them in memory, and falls back to
 * process.env so local development (.env.local) still works without
 * needing Secret Manager access.
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

let _client: SecretManagerServiceClient | null = null;

function getClient(): SecretManagerServiceClient {
  if (!_client) {
    _client = new SecretManagerServiceClient();
  }
  return _client;
}

/** In-memory cache: secretName → resolved value */
const cache = new Map<string, string>();

/** Resolve the GCP project ID from available env vars. */
function projectId(): string {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    ''
  );
}

/**
 * Fetch a secret value from Secret Manager, with:
 * - In-memory caching (one fetch per process lifetime)
 * - Fallback to process.env[name] for local development
 *
 * @param name  Secret name in Secret Manager (also used as the env var fallback key)
 * @param version  Secret version, defaults to "latest"
 */
export async function getSecret(name: string, version = 'latest'): Promise<string> {
  if (cache.has(name)) return cache.get(name)!;

  const project = projectId();

  if (project) {
    try {
      const client = getClient();
      const secretName = `projects/${project}/secrets/${name}/versions/${version}`;
      const [response] = await client.accessSecretVersion({ name: secretName });
      const value = response.payload?.data?.toString() ?? '';
      if (value) {
        cache.set(name, value);
        return value;
      }
    } catch {
      // Fall through to env var fallback
    }
  }

  // Fallback: use env var (works in local dev via .env.local)
  const envValue = process.env[name] ?? '';
  if (envValue) cache.set(name, envValue);
  return envValue;
}

/**
 * Load all application secrets into process.env from Secret Manager.
 * Called once at server startup via src/instrumentation.ts.
 * Existing env vars are NOT overwritten (Secret Manager values take precedence).
 */
export async function loadSecretsToEnv(): Promise<void> {
  const secretNames = [
    'ENCRYPTION_KEY',
    'WORKER_SECRET',
    'META_APP_ID',
    'META_APP_SECRET',
    'INSTAGRAM_APP_ID',
    'INSTAGRAM_APP_SECRET',
    'TIKTOK_CLIENT_KEY',
    'TIKTOK_CLIENT_SECRET',
    'LINKEDIN_CLIENT_ID',
    'LINKEDIN_CLIENT_SECRET',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
    // Stripe — API key + webhook signing secret are true secrets; price IDs
    // are non-secret config but live here too so the whole Stripe env set is
    // managed in one place and stays in sync with scripts/sync-stripe-prices.mjs.
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_STARTER_MONTHLY',
    'STRIPE_PRICE_STARTER_ANNUAL',
    'STRIPE_PRICE_PRO_MONTHLY',
    'STRIPE_PRICE_PRO_ANNUAL',
    'STRIPE_PRICE_BUSINESS_MONTHLY',
    'STRIPE_PRICE_BUSINESS_ANNUAL',
  ];

  await Promise.all(
    secretNames.map(async (name) => {
      try {
        const value = await getSecret(name);
        if (value) {
          process.env[name] = value;
        }
      } catch {
        // Non-fatal — local dev may not have all secrets in Secret Manager
      }
    }),
  );
}
