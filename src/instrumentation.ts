/**
 * Next.js instrumentation hook — runs once on server startup.
 * Loads secrets from Google Cloud Secret Manager into process.env
 * so all existing process.env reads work without any call-site changes.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run in the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { loadSecretsToEnv } = await import('@/lib/secrets');
    await loadSecretsToEnv();
  }
}
