import OpenAI from 'openai';
import type { BrandVoice } from '@/lib/schemas';
import { generateTTS } from './ugc-video-generator';
import type { KokoroVoice } from './ugc-video-generator';
import { submitMultiPromptToFal, mergeAudioVideo, pollFal, uploadVideoToStorage } from './video-generator';

// ── Types ────────────────────────────────────────────────────────────

export type FacelessNarratedRequest = {
  productName: string;
  productDescription: string;
  productCategories?: string[];
  brandVoice?: BrandVoice;
  sceneCount: number;
  durationSeconds: number;
  voice: string;
  speed: number;
  /** Pre-written script — if not provided, AI generates one */
  script?: string;
  scriptStyle: string;
  trendContext?: {
    name: string;
    format: string;
    hooks: string[];
  };
};

export type FacelessNarratedSubmitResult = {
  externalJobId: string;
  statusUrl: string;
  responseUrl: string;
  audioUrl: string;
  narrationScript: string;
  scenes: { prompt: string; duration: string }[];
};

type NarrationScript = {
  narration: string;
  scenes: { visualPrompt: string; durationSeconds: number }[];
};

// ── Script + Scene generator ─────────────────────────────────────────

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
};

async function generateNarrationWithScenes(
  req: FacelessNarratedRequest,
): Promise<NarrationScript> {
  // If user provided a script, generate scene visuals for it
  const hasCustomScript = !!req.script?.trim();

  const client = getClient();
  const secondsPerScene = Math.round(req.durationSeconds / req.sceneCount);

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2048,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You create faceless TikTok video scripts with scene-by-scene visual direction.

The video has NO face, NO avatar — just cinematic B-roll visuals with a voiceover narration.

Rules for the narration:
- Hook in the first 2 seconds — curiosity, bold claim, or pattern interrupt
- Natural, conversational tone — like telling a friend something interesting
- ${Math.round(req.durationSeconds * 2.5)} words total (2.5 words/second)
- Short sentences. Pauses with "..." for beats.
- End with a clear takeaway or CTA

Rules for each visual scene:
- Describe EXACTLY what the camera sees — shot type, subject, movement, lighting
- Cinematic director-style prompts: "Close-up of...", "Slow pan across...", "Overhead shot of..."
- Physical products, textures, environments — NO text, NO faces, NO abstract concepts
- Each scene must be visually distinct from the others
- Vertical 9:16 framing. No text overlays, no watermarks.

Return valid JSON only.`,
      },
      {
        role: 'user',
        content: `Create a faceless narrated TikTok video for:

Product: "${req.productName}"
Description: ${req.productDescription || 'Not provided'}
Categories: ${req.productCategories?.join(', ') || 'General'}
Brand tone: ${req.brandVoice?.tone || 'Confident and authentic'}
${req.trendContext ? `Trend: "${req.trendContext.name}" — ${req.trendContext.format}` : ''}
${req.trendContext?.hooks?.length ? `Hook inspiration: ${req.trendContext.hooks[0]}` : ''}

${hasCustomScript ? `Use this narration script (generate matching visuals for it):\n"${req.script}"` : `Script style: ${req.scriptStyle}`}

Target: ${req.durationSeconds} seconds total, ${req.sceneCount} scenes (~${secondsPerScene}s each)

Return JSON:
{
  "narration": "The full voiceover narration text",
  "scenes": [
    { "visualPrompt": "Cinematic description of what the camera sees...", "durationSeconds": ${secondsPerScene} },
    ...
  ]
}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '{}';
  return JSON.parse(text);
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Submit a faceless narrated video generation:
 * 1. Generate narration script + scene prompts (LLM)
 * 2. Kokoro TTS → narration audio (parallel with step 3)
 * 3. Kling multi-prompt → multi-shot silent video
 * 4. (After polling completes) FFmpeg merge audio + video
 *
 * Steps 1-3 happen here. Step 4 happens during poll completion.
 */
export async function submitFacelessNarrated(
  req: FacelessNarratedRequest,
): Promise<FacelessNarratedSubmitResult> {
  // 1. Generate narration + scene breakdowns
  const narration = await generateNarrationWithScenes(req);

  // Build Kling multi_prompt scenes
  const scenes = narration.scenes.map((s) => ({
    prompt: [
      s.visualPrompt,
      'Vertical 9:16. Cinematic color grading. Smooth camera movement.',
      'No text, no faces, no watermarks, no UI overlays.',
    ].join('\n'),
    duration: String(s.durationSeconds <= 5 ? 5 : 10),
  }));

  // 2. TTS + video generation in parallel
  const [audioUrl, falResult] = await Promise.all([
    generateTTS(narration.narration, req.voice as KokoroVoice, req.speed),
    submitMultiPromptToFal(scenes),
  ]);

  return {
    externalJobId: falResult.request_id,
    statusUrl: falResult.status_url,
    responseUrl: falResult.response_url,
    audioUrl,
    narrationScript: narration.narration,
    scenes,
  };
}

/**
 * Poll a faceless narrated video and merge audio when the video completes.
 * Returns the final merged video URL, or polling status.
 */
export async function pollFacelessNarrated(
  statusUrl: string,
  responseUrl: string,
  audioUrl: string,
  workspaceId: string,
): Promise<{ status: string; videoUrl?: string; errorMessage?: string }> {
  const result = await pollFal(statusUrl, responseUrl);

  if (result.status === 'completed' && result.videoUrl) {
    // Merge narration audio with the silent video
    const mergedUrl = await mergeAudioVideo(result.videoUrl, audioUrl);
    // Upload final video to Firebase Storage
    const storageUrl = await uploadVideoToStorage(mergedUrl, workspaceId);
    return { status: 'completed', videoUrl: storageUrl };
  }

  if (result.status === 'failed') {
    return { status: 'failed', errorMessage: result.errorMessage };
  }

  return { status: 'generating' };
}
