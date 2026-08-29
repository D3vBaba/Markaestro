import { z } from 'zod';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { listJobRuns } from '@/lib/public-api/job-runs-list';

export const runtime = 'nodejs';

const JOB_RUNS_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().max(2000).optional(),
  status: z.string().trim().max(100).optional(),
  /** Narrow to the runs for one post, which is the common support question. */
  resourceId: z.string().trim().max(200).optional(),
});

export async function GET(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'job_runs.read',
      rateLimit: JOB_RUNS_RATE_LIMIT,
    });
    const query = listSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const { runs, nextCursor } = await listJobRuns(ctx.workspaceId, ctx.productId, query);
    return Response.json(
      { runs, count: runs.length, nextCursor },
      { headers: ctx.rateLimitHeaders },
    );
  } catch (error) {
    return publicApiError(error);
  }
}
