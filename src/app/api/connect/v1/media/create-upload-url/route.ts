// Connect API: POST /api/connect/v1/media/create-upload-url
// Mints a short-lived, single-use signed PUT url. the client then PUTs the raw
// image bytes to it (see ../upload). Returns { media_id, upload_url }.
import crypto from 'crypto';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { signUploadToken, requestOrigin } from '@/lib/public-api/connect-compat';

export const runtime = 'nodejs';

const MEDIA_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function POST(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'media.write',
      rateLimit: MEDIA_RATE_LIMIT,
    });

    const body = (await req.json().catch(() => ({}))) as {
      mime_type?: string;
      size_bytes?: number;
      name?: string;
    };
    const mime = body.mime_type || 'image/png';

    const assetId = `ast_${crypto.randomUUID()}`;
    const token = signUploadToken({ ws: ctx.workspaceId, assetId, mime });
    const upload_url = `${requestOrigin(req)}/api/connect/v1/media/upload?token=${encodeURIComponent(token)}`;

    return Response.json({ media_id: assetId, upload_url }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
