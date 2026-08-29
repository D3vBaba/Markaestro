import { buildOpenApiDocument } from '@/lib/public-api/openapi';
import { publicApiError } from '@/lib/public-api/response';

export const runtime = 'nodejs';

/**
 * The machine-readable API description.
 *
 * Deliberately unauthenticated: a spec an integrator cannot fetch before they
 * have a key is a spec they read from a blog post instead. It describes shapes
 * and error codes, never data.
 *
 * Built from the same Zod schemas the routes validate against, so this can
 * never describe an API this deployment does not serve, even if the committed
 * `openapi/markaestro-v1.json` were somehow stale.
 */
export async function GET() {
  try {
    return Response.json(buildOpenApiDocument(), {
      headers: {
        // Public and immutable within a deploy. A minute is short enough that a
        // release is visible promptly and long enough to absorb a docs page.
        'cache-control': 'public, max-age=60, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    // The document is built from schemas at request time, so a malformed
    // schema would otherwise surface here as a framework 500 with an
    // unparseable body, on the one endpoint whose job is to be readable.
    return publicApiError(error);
  }
}
