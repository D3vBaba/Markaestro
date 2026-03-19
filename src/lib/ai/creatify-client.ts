import { fetchWithRetry } from '@/lib/fetch-retry';
import { getSecret } from '@/lib/secrets';

const CREATIFY_API = 'https://api.creatify.ai/api';

// ── Types ────────────────────────────────────────────────────────────

export type CreatifyAvatar = {
  id: string;
  gender: string;
  age_range: string;
  location: string;
  style: string;
  creator_name: string;
  video_scene: string;
  suitable_industries: string[];
  preview_image_9x16?: string;
  preview_video_9x16?: string;
  is_active: boolean;
};

export type CreatifyLipsyncRequest = {
  text: string;
  creator: string;
  aspect_ratio: '9x16' | '16x9' | '1x1';
  no_caption?: boolean;
  no_music?: boolean;
  caption_style?: string;
};

export type CreatifyLipsyncResponse = {
  id: string;
  status: 'pending' | 'in_queue' | 'running' | 'done' | 'failed';
  output?: string;
  video_thumbnail?: string;
  duration?: number;
  credits_used?: number;
  failed_reason?: string;
};

// ── Auth ─────────────────────────────────────────────────────────────

async function creatifyHeaders(): Promise<Record<string, string>> {
  const apiId = await getSecret('CREATIFY_API_ID');
  const apiKey = await getSecret('CREATIFY_API_KEY');
  if (!apiId || !apiKey) throw new Error('CREATIFY_API_ID or CREATIFY_API_KEY is not configured');
  return {
    'X-API-ID': apiId,
    'X-API-KEY': apiKey,
    'Content-Type': 'application/json',
  };
}

// ── Avatars ──────────────────────────────────────────────────────────

/**
 * List available UGC avatars, optionally filtered by industry and style.
 */
export async function listAvatars(filters?: {
  gender?: string;
  style?: string;
  suitable_industries?: string;
}): Promise<CreatifyAvatar[]> {
  const params = new URLSearchParams();
  if (filters?.gender) params.set('gender', filters.gender);
  if (filters?.style) params.set('style', filters.style);
  if (filters?.suitable_industries) params.set('suitable_industries', filters.suitable_industries);

  const qs = params.toString();
  const url = `${CREATIFY_API}/personas/${qs ? `?${qs}` : ''}`;

  const res = await fetchWithRetry(
    url,
    { headers: await creatifyHeaders() },
    { timeoutMs: 15_000 },
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Creatify listAvatars failed: ${JSON.stringify(data).slice(0, 500)}`);
  }

  return res.json();
}

// ── Lipsync (UGC video generation) ───────────────────────────────────

/**
 * Submit a UGC video generation job. The script text is spoken by the avatar.
 * Returns immediately with a job ID for polling.
 */
export async function submitLipsync(req: CreatifyLipsyncRequest): Promise<CreatifyLipsyncResponse> {
  const res = await fetchWithRetry(
    `${CREATIFY_API}/lipsyncs/`,
    {
      method: 'POST',
      headers: await creatifyHeaders(),
      body: JSON.stringify({
        text: req.text,
        creator: req.creator,
        aspect_ratio: req.aspect_ratio,
        no_caption: req.no_caption ?? false,
        no_music: req.no_music ?? true,
        caption_style: req.caption_style || 'neo',
      }),
    },
    { timeoutMs: 30_000 },
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Creatify lipsync failed: ${data.detail || JSON.stringify(data).slice(0, 500)}`);
  }

  return data;
}

/**
 * Poll the status of a lipsync job.
 */
export async function pollLipsync(jobId: string): Promise<CreatifyLipsyncResponse> {
  const res = await fetchWithRetry(
    `${CREATIFY_API}/lipsyncs/${jobId}/`,
    { headers: await creatifyHeaders() },
    { timeoutMs: 15_000, maxRetries: 1 },
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Creatify poll failed: ${JSON.stringify(data).slice(0, 500)}`);
  }

  return data;
}
