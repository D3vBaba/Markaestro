import crypto from 'crypto';
import { fetchWithRetry } from '@/lib/fetch-retry';
import { getSecret } from '@/lib/secrets';
import type { BrandVoice, VideoProvider } from '@/lib/schemas';

// ── Types ────────────────────────────────────────────────────────────

export type VideoGenRequest = {
  prompt: string;
  productName?: string;
  productDescription?: string;
  productCategories?: string[];
  brandVoice?: BrandVoice;
  provider: VideoProvider;
  durationSeconds: number;
  /** Optional trend context to shape the video */
  trendContext?: {
    name: string;
    format: string;
    hooks: string[];
  };
};

export type VideoGenSubmitResult = {
  /** Provider-specific job/request ID for polling */
  externalJobId: string;
  provider: VideoProvider;
};

export type VideoGenPollResult = {
  status: 'pending' | 'generating' | 'completed' | 'failed';
  videoUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string;
};

// ── fal.ai client ────────────────────────────────────────────────────

const FAL_API = 'https://queue.fal.run';

async function getFalApiKey(): Promise<string> {
  const key = await getSecret('FAL_API_KEY');
  if (!key) throw new Error('FAL_API_KEY is not configured');
  return key;
}

async function falHeaders(): Promise<Record<string, string>> {
  return {
    Authorization: `Key ${await getFalApiKey()}`,
    'Content-Type': 'application/json',
  };
}

// ── Video prompt builder ─────────────────────────────────────────────

function buildVideoPrompt(req: VideoGenRequest): string {
  const sections: string[] = [];

  sections.push(
    'PLATFORM: TikTok — vertical 9:16 video optimized for mobile viewing.',
    'The video must feel native to TikTok: authentic, bold, and attention-grabbing in the first 1-2 seconds.',
  );

  if (req.trendContext) {
    sections.push(
      `TREND FORMAT: "${req.trendContext.name}" — ${req.trendContext.format}`,
      req.trendContext.hooks.length > 0
        ? `HOOK STYLES: ${req.trendContext.hooks.join('; ')}`
        : '',
    );
  }

  if (req.productName) {
    const productLines = [`Product: "${req.productName}"`];
    if (req.productDescription) productLines.push(`What it does: ${req.productDescription.slice(0, 300)}`);
    if (req.productCategories?.length) productLines.push(`Category: ${req.productCategories.join(', ')}`);
    sections.push('PRODUCT CONTEXT:', ...productLines);
  }

  if (req.brandVoice?.tone) {
    sections.push(`MOOD/TONE: ${req.brandVoice.tone}`);
  }

  sections.push(
    `VIDEO DIRECTION: ${req.prompt}`,
    '',
    'TECHNICAL: Vertical 9:16 aspect ratio. Keep key visual elements in center 60% of frame.',
    `Duration: ${req.durationSeconds} seconds.`,
    'High energy opening — the first frame must hook viewers.',
    'No text overlays or watermarks (those will be added in post-production).',
  );

  return sections.filter(Boolean).join('\n');
}

// ── Provider: Kling (via fal.ai) ─────────────────────────────────────

async function submitKling(prompt: string, durationSeconds: number): Promise<string> {
  const res = await fetchWithRetry(
    `${FAL_API}/fal-ai/kling-video/v2.6/pro/text-to-video`,
    {
      method: 'POST',
      headers: await falHeaders(),
      body: JSON.stringify({
        prompt,
        duration: durationSeconds <= 5 ? '5' : '10',
        aspect_ratio: '9:16',
      }),
    },
    { timeoutMs: 30_000 },
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Kling submit failed: ${data.detail || JSON.stringify(data).slice(0, 500)}`);
  }

  return data.request_id;
}

async function pollKling(requestId: string): Promise<VideoGenPollResult> {
  const res = await fetchWithRetry(
    `${FAL_API}/fal-ai/kling-video/v2.6/pro/text-to-video/requests/${requestId}/status`,
    { headers: await falHeaders() },
    { timeoutMs: 15_000, maxRetries: 1 },
  );

  const data = await res.json();

  if (data.status === 'COMPLETED') {
    const video = data.response?.video;
    return {
      status: 'completed',
      videoUrl: video?.url || '',
      thumbnailUrl: video?.thumbnail_url || '',
    };
  }

  if (data.status === 'FAILED') {
    return {
      status: 'failed',
      errorMessage: data.error || 'Video generation failed',
    };
  }

  // IN_QUEUE or IN_PROGRESS
  return { status: 'generating' };
}

// ── Provider: Veo (via fal.ai) ──────────────────────────────────────

async function submitVeo(prompt: string, durationSeconds: number): Promise<string> {
  const res = await fetchWithRetry(
    `${FAL_API}/fal-ai/veo2`,
    {
      method: 'POST',
      headers: await falHeaders(),
      body: JSON.stringify({
        prompt,
        duration: durationSeconds <= 5 ? '5s' : '10s',
        aspect_ratio: '9:16',
      }),
    },
    { timeoutMs: 30_000 },
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Veo submit failed: ${data.detail || JSON.stringify(data).slice(0, 500)}`);
  }

  return data.request_id;
}

async function pollVeo(requestId: string): Promise<VideoGenPollResult> {
  const res = await fetchWithRetry(
    `${FAL_API}/fal-ai/veo2/requests/${requestId}/status`,
    { headers: await falHeaders() },
    { timeoutMs: 15_000, maxRetries: 1 },
  );

  const data = await res.json();

  if (data.status === 'COMPLETED') {
    const video = data.response?.video;
    return {
      status: 'completed',
      videoUrl: video?.url || '',
      thumbnailUrl: video?.thumbnail_url || '',
    };
  }

  if (data.status === 'FAILED') {
    return {
      status: 'failed',
      errorMessage: data.error || 'Video generation failed',
    };
  }

  return { status: 'generating' };
}

// ── Provider: Sora (via fal.ai) ─────────────────────────────────────

async function submitSora(prompt: string, durationSeconds: number): Promise<string> {
  const res = await fetchWithRetry(
    `${FAL_API}/fal-ai/sora`,
    {
      method: 'POST',
      headers: await falHeaders(),
      body: JSON.stringify({
        prompt,
        duration: durationSeconds,
        aspect_ratio: '9:16',
        resolution: '1080p',
      }),
    },
    { timeoutMs: 30_000 },
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Sora submit failed: ${data.detail || JSON.stringify(data).slice(0, 500)}`);
  }

  return data.request_id;
}

async function pollSora(requestId: string): Promise<VideoGenPollResult> {
  const res = await fetchWithRetry(
    `${FAL_API}/fal-ai/sora/requests/${requestId}/status`,
    { headers: await falHeaders() },
    { timeoutMs: 15_000, maxRetries: 1 },
  );

  const data = await res.json();

  if (data.status === 'COMPLETED') {
    const video = data.response?.video;
    return {
      status: 'completed',
      videoUrl: video?.url || '',
      thumbnailUrl: video?.thumbnail_url || '',
    };
  }

  if (data.status === 'FAILED') {
    return {
      status: 'failed',
      errorMessage: data.error || 'Video generation failed',
    };
  }

  return { status: 'generating' };
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Submit a video generation job. Returns immediately with a job ID for polling.
 * Videos take 1-5 minutes to generate depending on the provider.
 */
export async function submitVideoGeneration(req: VideoGenRequest): Promise<VideoGenSubmitResult> {
  const prompt = buildVideoPrompt(req);

  let externalJobId: string;

  switch (req.provider) {
    case 'kling':
      externalJobId = await submitKling(prompt, req.durationSeconds);
      break;
    case 'veo':
      externalJobId = await submitVeo(prompt, req.durationSeconds);
      break;
    case 'sora':
      externalJobId = await submitSora(prompt, req.durationSeconds);
      break;
    default:
      throw new Error(`Unsupported video provider: ${req.provider}`);
  }

  return { externalJobId, provider: req.provider };
}

/**
 * Poll the status of a video generation job.
 */
export async function pollVideoGeneration(provider: VideoProvider, externalJobId: string): Promise<VideoGenPollResult> {
  switch (provider) {
    case 'kling':
      return pollKling(externalJobId);
    case 'veo':
      return pollVeo(externalJobId);
    case 'sora':
      return pollSora(externalJobId);
    default:
      throw new Error(`Unsupported video provider: ${provider}`);
  }
}

/**
 * Upload a video from URL to Firebase Storage and return a permanent URL.
 */
export async function uploadVideoToStorage(
  videoUrl: string,
  workspaceId: string,
): Promise<string> {
  const admin = await import('firebase-admin');
  const bucket = admin.storage().bucket();

  // Download the video from the provider
  const res = await fetchWithRetry(videoUrl, undefined, { timeoutMs: 120_000 });
  if (!res.ok) throw new Error(`Failed to download video: ${videoUrl}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const fileId = crypto.randomUUID();
  const filePath = `workspaces/${workspaceId}/videos/${fileId}.mp4`;
  const file = bucket.file(filePath);

  await file.save(buffer, {
    metadata: {
      contentType: 'video/mp4',
      metadata: {
        workspaceId,
        generatedAt: new Date().toISOString(),
      },
    },
  });

  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${filePath}`;
}
