import { fetchWithRetry } from '@/lib/fetch-retry';
import { getSecret } from '@/lib/secrets';

/**
 * UGC video generation via fal.ai MultiTalk (ai-avatar/single-text).
 * Takes a script + face image → talking-head video with lip-sync.
 * Uses the same fal.ai queue pattern as the Kling video generator.
 */

const FAL_API = 'https://queue.fal.run';

async function falHeaders(): Promise<Record<string, string>> {
  const key = await getSecret('FAL_API_KEY');
  if (!key) throw new Error('FAL_API_KEY is not configured');
  return {
    Authorization: `Key ${key}`,
    'Content-Type': 'application/json',
  };
}

// ── Types ────────────────────────────────────────────────────────────

export const UGC_VOICES = [
  'Aria', 'Roger', 'Sarah', 'Laura', 'Charlie', 'George',
  'Callum', 'River', 'Liam', 'Charlotte', 'Alice', 'Matilda',
  'Will', 'Jessica', 'Eric', 'Chris', 'Brian', 'Daniel', 'Lily', 'Bill',
] as const;

export type UGCVoice = typeof UGC_VOICES[number];

export type UGCVideoRequest = {
  /** URL of the face image for the avatar */
  imageUrl: string;
  /** The script text the avatar will speak */
  script: string;
  /** Voice for TTS */
  voice: UGCVoice;
  /** Scene/style description for the video */
  scenePrompt: string;
  /** Resolution: 480p or 720p */
  resolution?: '480p' | '720p';
};

export type UGCVideoSubmitResult = {
  externalJobId: string;
  statusUrl: string;
  responseUrl: string;
};

export type UGCVideoPollResult = {
  status: 'generating' | 'completed' | 'failed';
  videoUrl?: string;
  errorMessage?: string;
};

// ── Submit ───────────────────────────────────────────────────────────

export async function submitUGCVideo(req: UGCVideoRequest): Promise<UGCVideoSubmitResult> {
  const res = await fetchWithRetry(
    `${FAL_API}/fal-ai/ai-avatar/single-text`,
    {
      method: 'POST',
      headers: await falHeaders(),
      body: JSON.stringify({
        image_url: req.imageUrl,
        text_input: req.script,
        voice: req.voice,
        prompt: req.scenePrompt,
        resolution: req.resolution || '720p',
        num_frames: 129, // max for longer videos
        acceleration: 'regular',
      }),
    },
    { timeoutMs: 30_000 },
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`UGC video submit failed: ${data.detail || JSON.stringify(data).slice(0, 500)}`);
  }

  return {
    externalJobId: data.request_id,
    statusUrl: data.status_url,
    responseUrl: data.response_url,
  };
}

// ── Poll ─────────────────────────────────────────────────────────────

export async function pollUGCVideo(statusUrl: string, responseUrl: string): Promise<UGCVideoPollResult> {
  const headers = await falHeaders();

  const statusRes = await fetchWithRetry(
    statusUrl,
    { headers },
    { timeoutMs: 15_000, maxRetries: 1 },
  );
  const statusData = await statusRes.json();

  if (statusData.status === 'COMPLETED') {
    // Fetch the actual result
    const resultRes = await fetchWithRetry(
      responseUrl,
      { headers },
      { timeoutMs: 30_000, maxRetries: 2 },
    );
    const resultData = await resultRes.json();

    return {
      status: 'completed',
      videoUrl: resultData.video?.url || '',
    };
  }

  if (statusData.status === 'FAILED') {
    return {
      status: 'failed',
      errorMessage: statusData.error || 'UGC video generation failed',
    };
  }

  return { status: 'generating' };
}
