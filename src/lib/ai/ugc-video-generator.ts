import { fetchWithRetry } from '@/lib/fetch-retry';
import { getSecret } from '@/lib/secrets';

/**
 * UGC video generation via fal.ai — two-step pipeline:
 * 1. Kokoro TTS: script text → audio ($0.02/1K chars)
 * 2. Kling AI Avatar v2: image + audio → talking-head video ($0.056/sec)
 *
 * Total cost for a 30-second video: ~$1.70 (vs $4.50 with VEED Fabric)
 */

const FAL_API = 'https://queue.fal.run';
const FAL_SYNC = 'https://fal.run';

async function falHeaders(): Promise<Record<string, string>> {
  const key = await getSecret('FAL_API_KEY');
  if (!key) throw new Error('FAL_API_KEY is not configured');
  return {
    Authorization: `Key ${key}`,
    'Content-Type': 'application/json',
  };
}

// ── Types ────────────────────────────────────────────────────────────

export const KOKORO_VOICES = {
  female: ['af_heart', 'af_alloy', 'af_bella', 'af_jessica', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky'],
  male: ['am_adam', 'am_echo', 'am_eric', 'am_liam', 'am_michael', 'am_onyx', 'am_puck'],
} as const;

export type KokoroVoice = typeof KOKORO_VOICES.female[number] | typeof KOKORO_VOICES.male[number];

export type UGCVideoRequest = {
  /** URL of the face image for the avatar */
  imageUrl: string;
  /** The script text the avatar will speak */
  script: string;
  /** Kokoro voice ID */
  voice: KokoroVoice;
  /** Speech speed multiplier (0.5–2.0) */
  speed?: number;
};

export type UGCVideoSubmitResult = {
  externalJobId: string;
  statusUrl: string;
  responseUrl: string;
  /** URL of the generated TTS audio (for debugging/preview) */
  audioUrl: string;
};

export type UGCVideoPollResult = {
  status: 'generating' | 'completed' | 'failed';
  videoUrl?: string;
  duration?: number;
  errorMessage?: string;
};

// ── Step 1: TTS via Kokoro (synchronous — fast, <5 seconds) ─────────

export async function generateTTS(script: string, voice: KokoroVoice, speed: number): Promise<string> {
  const res = await fetchWithRetry(
    `${FAL_SYNC}/fal-ai/kokoro/american-english`,
    {
      method: 'POST',
      headers: await falHeaders(),
      body: JSON.stringify({
        prompt: script,
        voice,
        speed,
      }),
    },
    { timeoutMs: 60_000, maxRetries: 2 },
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`TTS failed: ${data.detail || JSON.stringify(data).slice(0, 500)}`);
  }

  const audioUrl = data.audio?.url;
  if (!audioUrl) throw new Error('TTS returned no audio URL');
  return audioUrl;
}

// ── Step 2: Kling AI Avatar v2 (async — queued) ─────────────────────

async function submitAvatar(imageUrl: string, audioUrl: string): Promise<{ requestId: string; statusUrl: string; responseUrl: string }> {
  const res = await fetchWithRetry(
    `${FAL_API}/fal-ai/kling-video/ai-avatar/v2/standard`,
    {
      method: 'POST',
      headers: await falHeaders(),
      body: JSON.stringify({
        image_url: imageUrl,
        audio_url: audioUrl,
      }),
    },
    { timeoutMs: 30_000 },
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Avatar submit failed: ${data.detail || JSON.stringify(data).slice(0, 500)}`);
  }

  return {
    requestId: data.request_id,
    statusUrl: data.status_url,
    responseUrl: data.response_url,
  };
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Submit a UGC video generation: TTS → Kling Avatar.
 * TTS runs synchronously (~2-5 seconds), then avatar job is queued.
 */
export async function submitUGCVideo(req: UGCVideoRequest): Promise<UGCVideoSubmitResult> {
  const speed = req.speed || 1.0;

  // Step 1: Generate speech audio
  const audioUrl = await generateTTS(req.script, req.voice, speed);

  // Step 2: Submit avatar generation with image + audio
  const avatar = await submitAvatar(req.imageUrl, audioUrl);

  return {
    externalJobId: avatar.requestId,
    statusUrl: avatar.statusUrl,
    responseUrl: avatar.responseUrl,
    audioUrl,
  };
}

/**
 * Poll the status of a Kling Avatar job.
 */
export async function pollUGCVideo(statusUrl: string, responseUrl: string): Promise<UGCVideoPollResult> {
  const headers = await falHeaders();

  const statusRes = await fetchWithRetry(
    statusUrl,
    { headers },
    { timeoutMs: 15_000, maxRetries: 1 },
  );
  const statusData = await statusRes.json();

  if (statusData.status === 'COMPLETED') {
    const resultRes = await fetchWithRetry(
      responseUrl,
      { headers },
      { timeoutMs: 30_000, maxRetries: 2 },
    );
    const resultData = await resultRes.json();

    return {
      status: 'completed',
      videoUrl: resultData.video?.url || '',
      duration: resultData.duration || 0,
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
