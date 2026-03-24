import type { ProductSceneType, VideoProvider } from '@/lib/schemas';
import { generateWithGemini, fetchImageAsBase64, uploadToFirebaseStorage } from './image-generator';
import { submitToFal } from './video-generator';
import { generateTTS } from './ugc-video-generator';
import type { KokoroVoice } from './ugc-video-generator';

// ── Types ────────────────────────────────────────────────────────────

export type ProductSceneRequest = {
  productId: string;
  productName: string;
  productDescription: string;
  productCategories?: string[];
  sceneType: ProductSceneType;
  avatarImageUrl?: string;
  productImageUrl?: string;
  sceneDescription?: string;
  provider: VideoProvider;
  durationSeconds: number;
  voiceover?: {
    script: string;
    voice: string;
    speed: number;
  };
};

export type ProductSceneSubmitResult = {
  externalJobId: string;
  statusUrl: string;
  responseUrl: string;
  sceneImageUrl: string;
  audioUrl?: string;
};

// ── Scene prompt builder ─────────────────────────────────────────────

const SCENE_TEMPLATES: Record<ProductSceneType, (product: string, desc: string) => string> = {
  'product-in-hand': (product, desc) => [
    `Close-up of a person's hand naturally holding "${product}" — ${desc}.`,
    'Fingers wrapped comfortably around the product, as if examining it for the first time.',
    'Soft directional light from a window, warm tones. Shallow depth of field with a softly blurred lifestyle background.',
    'The product is the hero — sharp detail on the product surface, label, and packaging.',
    'Natural, candid moment — not posed or staged.',
  ].join('\n'),

  'unboxing': (product, desc) => [
    `Person's hands carefully opening a minimalist package to reveal "${product}" — ${desc}.`,
    'The moment of first reveal — anticipation and discovery. Package partially open, product becoming visible.',
    'Clean, well-lit tabletop or desk setting. Soft overhead lighting with gentle shadows.',
    'Focus on the tactile interaction — fingers on packaging, product emerging.',
  ].join('\n'),

  'routine': (product, desc) => [
    `Person naturally incorporating "${product}" into their daily routine — ${desc}.`,
    'Casual, authentic moment — morning bathroom, kitchen counter, or desk setup depending on the product type.',
    'The product is part of the scene, not the focal point of a pitch. Natural integration into a real moment.',
    'Warm, inviting lighting. Lived-in environment with personal touches visible.',
  ].join('\n'),

  'before-after': (product, desc) => [
    `A transformation moment featuring "${product}" — ${desc}.`,
    'Show the "after" state — the positive result of using the product. Confident expression, visible improvement.',
    'Clean composition with the product visible in frame. Bright, flattering lighting.',
    'The feeling of satisfaction and confidence after using the product.',
  ].join('\n'),

  'lifestyle': (product, desc) => [
    `Candid lifestyle moment with "${product}" naturally visible — ${desc}.`,
    'Person in a natural, aspirational setting that matches the product category.',
    "The product is present but not being pitched — it belongs in this person's life.",
    'Golden-hour or soft natural lighting. Authentic, editorial feel — like a magazine behind-the-scenes shot.',
  ].join('\n'),
};

function buildScenePrompt(
  sceneType: ProductSceneType,
  productName: string,
  productDescription: string,
  sceneDescription?: string,
): string {
  const base = sceneDescription
    ? sceneDescription
    : SCENE_TEMPLATES[sceneType](productName, productDescription.slice(0, 200));

  return [
    base,
    '',
    'Vertical 9:16 framing. Photorealistic, shot on iPhone 15 Pro.',
    'Natural skin texture, real environment. No text, no watermarks, no UI overlays.',
  ].join('\n');
}

function buildMotionPrompt(sceneType: ProductSceneType, productName: string): string {
  switch (sceneType) {
    case 'product-in-hand':
      return `Slow, natural hand movement — person gently tilts and examines ${productName}, fingers shift slightly. Subtle camera drift. Shallow depth of field.`;
    case 'unboxing':
      return `Hands continue opening the package, revealing ${productName} fully. Slow, satisfying motion. Camera holds steady with slight push-in.`;
    case 'routine':
      return `Person naturally reaches for and uses ${productName} in their routine. Smooth, casual movement. Handheld camera feel with gentle sway.`;
    case 'before-after':
      return `Person turns to camera with confident expression, ${productName} visible. Subtle hair/clothing movement. Soft camera drift.`;
    case 'lifestyle':
      return `Gentle ambient movement — person shifts naturally, breeze in hair or clothes. ${productName} stays visible. Slow cinematic camera pan.`;
  }
}

// ── Public API ───────────────────────────────────────────────────────

export async function submitProductScene(
  req: ProductSceneRequest,
  workspaceId: string,
): Promise<ProductSceneSubmitResult> {
  // 1. Build the scene image prompt
  const scenePrompt = buildScenePrompt(
    req.sceneType,
    req.productName,
    req.productDescription,
    req.sceneDescription,
  );

  // 2. Collect reference images for Gemini (avatar face + product photo)
  const referenceImages: { base64: string; mimeType: string }[] = [];
  const fetchPromises: Promise<void>[] = [];

  if (req.avatarImageUrl) {
    fetchPromises.push(
      fetchImageAsBase64(req.avatarImageUrl)
        .then((img) => { referenceImages.push(img); })
        .catch((e) => console.warn('Failed to fetch avatar reference:', e)),
    );
  }
  if (req.productImageUrl) {
    fetchPromises.push(
      fetchImageAsBase64(req.productImageUrl)
        .then((img) => { referenceImages.push(img); })
        .catch((e) => console.warn('Failed to fetch product reference:', e)),
    );
  }
  await Promise.all(fetchPromises);

  // 3. Generate the scene still image with Gemini
  const sceneImage = await generateWithGemini(
    scenePrompt,
    '9:16',
    referenceImages.length > 0 ? referenceImages : undefined,
  );

  // 4. Upload scene image to Firebase Storage
  const sceneImageUrl = await uploadToFirebaseStorage(sceneImage.base64, sceneImage.mimeType, workspaceId);

  // 5. Submit image-to-video + optional TTS in parallel
  const motionPrompt = buildMotionPrompt(req.sceneType, req.productName);

  const [falResult, audioUrl] = await Promise.all([
    submitToFal(req.provider, motionPrompt, req.durationSeconds, sceneImageUrl),
    req.voiceover
      ? generateTTS(req.voiceover.script, req.voiceover.voice as KokoroVoice, req.voiceover.speed)
      : Promise.resolve(undefined),
  ]);

  return {
    externalJobId: falResult.request_id,
    statusUrl: falResult.status_url,
    responseUrl: falResult.response_url,
    sceneImageUrl,
    audioUrl,
  };
}
