import crypto from 'crypto';
import { fetchWithRetry } from '@/lib/fetch-retry';
import { getSecret } from '@/lib/secrets';
import type { BrandVoice, PromptMode, VideoProvider } from '@/lib/schemas';

// ── Types ────────────────────────────────────────────────────────────

export type VideoGenRequest = {
  prompt: string;
  promptMode?: PromptMode;
  customPrompt?: string;
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
  /** fal.ai status URL — use this for polling instead of constructing URLs */
  statusUrl: string;
  /** fal.ai response URL — use this to fetch the result once COMPLETED */
  responseUrl: string;
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

/**
 * Build a cinematic, highly descriptive prompt optimized for Kling 2.6 Pro.
 *
 * Kling performs best with prompts that are:
 * - Visually specific (describe lighting, camera movement, colors, textures)
 * - Scene-oriented (what is physically happening frame by frame)
 * - Cinematically directed (camera angles, depth of field, pacing)
 * - NOT abstract or conceptual — Kling needs concrete visual descriptions
 */
function buildGuidedVideoPrompt(req: VideoGenRequest): string {
  const lines: string[] = [];

  // Core cinematic direction — this is what Kling needs most
  lines.push(req.prompt);

  // Add trend-specific visual language
  if (req.trendContext) {
    lines.push(
      '',
      `Visual style inspired by "${req.trendContext.name}" trend: ${req.trendContext.format}.`,
    );
    if (req.trendContext.hooks.length > 0) {
      lines.push(`Opening hook style: ${req.trendContext.hooks[0]}.`);
    }
  }

  // Add mood/tone as visual direction
  if (req.brandVoice?.tone) {
    lines.push(`The overall mood is ${req.brandVoice.tone}.`);
  }

  // Technical constraints — keep minimal, Kling handles these via params
  lines.push(
    '',
    'Vertical 9:16 framing. Cinematic color grading. Smooth, intentional camera movement.',
    'No text, no watermarks, no UI overlays.',
  );

  return lines.filter(Boolean).join('\n');
}

function buildCustomOverrideVideoPrompt(req: VideoGenRequest): string {
  const lines: string[] = [];
  const primaryBrief = req.customPrompt?.trim() || req.prompt.trim();

  lines.push(primaryBrief);
  lines.push('');
  lines.push('OVERRIDE RULE: The user brief above is the source of truth. Supporting context below must not replace, soften, or reinterpret it.');

  if (req.productName || req.productDescription || req.productCategories?.length) {
    lines.push('');
    lines.push('SUPPORTING PRODUCT CONTEXT:');
    if (req.productName) lines.push(`Product: ${req.productName}`);
    if (req.productDescription) lines.push(`Description: ${req.productDescription.slice(0, 200)}`);
    if (req.productCategories?.length) lines.push(`Categories: ${req.productCategories.join(', ')}`);
  }

  if (req.trendContext) {
    lines.push('');
    lines.push(`OPTIONAL TREND CONTEXT: ${req.trendContext.name} — ${req.trendContext.format}. Use only if it fits the user brief.`);
    if (req.trendContext.hooks.length > 0) {
      lines.push(`Optional opening hook inspiration: ${req.trendContext.hooks[0]}.`);
    }
  }

  if (req.brandVoice?.tone) {
    lines.push(`Optional brand tone support: ${req.brandVoice.tone}.`);
  }

  lines.push(
    '',
    'Vertical 9:16 framing. Cinematic color grading. Smooth, intentional camera movement.',
    'No text, no watermarks, no UI overlays.',
  );

  return lines.filter(Boolean).join('\n');
}

function buildVideoPrompt(req: VideoGenRequest): string {
  if (req.promptMode === 'custom_override') {
    return buildCustomOverrideVideoPrompt(req);
  }
  return buildGuidedVideoPrompt(req);
}

// ── fal.ai model endpoints ───────────────────────────────────────────

/** fal.ai model IDs — Creatify is handled separately via its own API */
const FAL_MODEL_IDS: Partial<Record<VideoProvider, string>> = {
  kling: 'fal-ai/kling-video/v2.6/pro/text-to-video',
  veo: 'fal-ai/veo2',
  sora: 'fal-ai/sora',
};

/** fal.ai image-to-video model IDs — used for animating still images */
const FAL_IMAGE_TO_VIDEO_IDS: Partial<Record<VideoProvider, string>> = {
  kling: 'fal-ai/kling-video/v2.6/pro/image-to-video',
  veo: 'fal-ai/veo2/image-to-video',
};

// ── Unified fal.ai submit ────────────────────────────────────────────

type FalSubmitResponse = {
  request_id: string;
  status_url: string;
  response_url: string;
};

export async function submitToFal(
  provider: VideoProvider,
  prompt: string,
  durationSeconds: number,
  imageUrl?: string,
): Promise<FalSubmitResponse> {
  // Pick text-to-video or image-to-video model based on whether an image is provided
  const modelId = imageUrl
    ? FAL_IMAGE_TO_VIDEO_IDS[provider]
    : FAL_MODEL_IDS[provider];
  if (!modelId) throw new Error(`Unsupported video provider for ${imageUrl ? 'image-to-video' : 'text-to-video'}: ${provider}`);

  // Build provider-specific input
  let input: Record<string, unknown>;
  switch (provider) {
    case 'kling':
      input = { prompt, duration: durationSeconds <= 5 ? '5' : '10', aspect_ratio: '9:16' };
      if (imageUrl) input.image_url = imageUrl;
      break;
    case 'veo':
      input = { prompt, duration: durationSeconds <= 5 ? '5s' : '10s', aspect_ratio: '9:16' };
      if (imageUrl) input.image_url = imageUrl;
      break;
    case 'sora':
      input = { prompt, duration: durationSeconds, aspect_ratio: '9:16', resolution: '1080p' };
      if (imageUrl) input.image_url = imageUrl;
      break;
    default:
      throw new Error(`Unsupported video provider: ${provider}`);
  }

  const res = await fetchWithRetry(
    `${FAL_API}/${modelId}`,
    {
      method: 'POST',
      headers: await falHeaders(),
      body: JSON.stringify(input),
    },
    { timeoutMs: 30_000 },
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`${provider} submit failed: ${data.detail || JSON.stringify(data).slice(0, 500)}`);
  }

  return {
    request_id: data.request_id,
    status_url: data.status_url,
    response_url: data.response_url,
  };
}

// ── Unified fal.ai poll ──────────────────────────────────────────────

export async function pollFal(statusUrl: string, responseUrl: string): Promise<VideoGenPollResult> {
  const headers = await falHeaders();

  // 1. Check status
  const statusRes = await fetchWithRetry(
    statusUrl,
    { headers },
    { timeoutMs: 15_000, maxRetries: 1 },
  );
  const statusData = await statusRes.json();

  if (statusData.status === 'COMPLETED') {
    // 2. Fetch the actual result from the response URL
    const resultRes = await fetchWithRetry(
      responseUrl,
      { headers },
      { timeoutMs: 30_000, maxRetries: 2 },
    );
    const resultData = await resultRes.json();

    // fal.ai may return a "detail" error even with COMPLETED status
    if (resultData.detail) {
      const errMsg = Array.isArray(resultData.detail)
        ? resultData.detail.map((d: { msg?: string }) => d.msg).join('; ')
        : String(resultData.detail);
      return { status: 'failed', errorMessage: `Video generation error: ${errMsg}` };
    }

    const video = resultData.video;
    if (!video?.url) {
      return { status: 'failed', errorMessage: 'Video generation completed but no video URL returned' };
    }
    return {
      status: 'completed',
      videoUrl: video.url,
      thumbnailUrl: video.thumbnail_url || '',
    };
  }

  if (statusData.status === 'FAILED') {
    return {
      status: 'failed',
      errorMessage: statusData.error || 'Video generation failed',
    };
  }

  // IN_QUEUE or IN_PROGRESS
  return { status: 'generating' };
}

// ── fal.ai FFmpeg helpers ────────────────────────────────────────────

const FAL_SYNC = 'https://fal.run';

/**
 * Merge a video and audio track using fal.ai FFmpeg API.
 * Returns the URL of the combined video.
 */
export async function mergeAudioVideo(
  videoUrl: string,
  audioUrl: string,
): Promise<string> {
  const res = await fetchWithRetry(
    `${FAL_SYNC}/fal-ai/ffmpeg-api/merge-audio-video`,
    {
      method: 'POST',
      headers: await falHeaders(),
      body: JSON.stringify({ video_url: videoUrl, audio_url: audioUrl }),
    },
    { timeoutMs: 120_000, maxRetries: 2 },
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`FFmpeg merge failed: ${data.detail || JSON.stringify(data).slice(0, 500)}`);
  }
  return data.video?.url || '';
}

/**
 * Submit a Kling multi-prompt (multi-shot) video generation job.
 * Generates multiple scenes in a single video with transitions.
 */
export async function submitMultiPromptToFal(
  scenes: { prompt: string; duration: string }[],
): Promise<FalSubmitResponse> {
  const res = await fetchWithRetry(
    `${FAL_API}/fal-ai/kling-video/v2.6/pro/text-to-video`,
    {
      method: 'POST',
      headers: await falHeaders(),
      body: JSON.stringify({
        prompt: scenes[0].prompt,
        multi_prompt: scenes,
        multi_prompt_type: 'customize',
        aspect_ratio: '9:16',
        generate_audio: false,
      }),
    },
    { timeoutMs: 30_000 },
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Kling multi-prompt submit failed: ${data.detail || JSON.stringify(data).slice(0, 500)}`);
  }

  return {
    request_id: data.request_id,
    status_url: data.status_url,
    response_url: data.response_url,
  };
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Submit a video generation job. Returns immediately with a job ID for polling.
 * Videos take 1-5 minutes to generate depending on the provider.
 */
export async function submitVideoGeneration(req: VideoGenRequest): Promise<VideoGenSubmitResult> {
  const prompt = buildVideoPrompt(req);
  const result = await submitToFal(req.provider, prompt, req.durationSeconds);

  return {
    externalJobId: result.request_id,
    provider: req.provider,
    statusUrl: result.status_url,
    responseUrl: result.response_url,
  };
}

/**
 * Poll the status of a video generation job.
 * Uses the stored status/response URLs from the submit response.
 */
export async function pollVideoGeneration(statusUrl: string, responseUrl: string): Promise<VideoGenPollResult> {
  return pollFal(statusUrl, responseUrl);
}

/**
 * Upload a video from URL to Firebase Storage and return a permanent URL.
 * Stores in the `generated/` prefix so it appears in the gallery alongside images.
 */
export async function uploadVideoToStorage(
  videoUrl: string,
  workspaceId: string,
): Promise<string> {
  const { uploadToStorage } = await import('@/lib/storage');

  // Download the video from the provider
  const res = await fetchWithRetry(videoUrl, undefined, { timeoutMs: 120_000 });
  if (!res.ok) throw new Error(`Failed to download video: ${videoUrl}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const fileId = crypto.randomUUID();
  // Store in `generated/` so gallery picks it up
  const filePath = `workspaces/${workspaceId}/generated/${fileId}.mp4`;

  return uploadToStorage(filePath, buffer, 'video/mp4', {
    workspaceId,
    generatedAt: new Date().toISOString(),
  });
}
