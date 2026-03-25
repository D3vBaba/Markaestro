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
    `Professional product photoshoot: close-up of a model's hand elegantly holding the physical product "${product}" — ${desc}.`,
    'Studio-quality lighting with a key light and soft fill. The physical product is the hero — every label, texture, and material is crisp and detailed.',
    'Shallow depth of field, creamy bokeh background. The hand holds the product at a slight angle to show dimension.',
    'Commercial photography aesthetic — this should look like it belongs in a Vogue or GQ product feature.',
  ].join('\n'),

  'unboxing': (product, desc) => [
    `Product photoshoot: hands carefully opening premium packaging to reveal the physical product "${product}" — ${desc}.`,
    'The unboxing moment captured like a commercial shoot — overhead angle, clean marble or wood surface.',
    'Studio lighting: soft overhead diffused light with subtle rim light catching the packaging edges.',
    'Tissue paper, branded box details, and the physical product emerging — tactile, premium feel.',
  ].join('\n'),

  'routine': (product, desc) => [
    `Lifestyle product photoshoot: model naturally using the physical product "${product}" in a styled routine setting — ${desc}.`,
    'Shot like an editorial spread — real environment but art-directed. The physical product is being actively used, not just placed.',
    'Warm, diffused natural light mixed with practical lighting. The setting matches the product category (bathroom for skincare, kitchen for food, vanity for beauty).',
    'Commercial authenticity — looks real but every element is intentional. Magazine-quality composition.',
  ].join('\n'),

  'before-after': (product, desc) => [
    `Product photoshoot: transformation moment featuring the physical product "${product}" — ${desc}.`,
    'The "after" moment — model looking confident with the physical product visible in frame.',
    'Split-tone lighting: dramatic but flattering. Clean background that keeps focus on the model and product.',
    'Commercial beauty/lifestyle photography aesthetic — polished, aspirational, editorial.',
  ].join('\n'),

  'lifestyle': (product, desc) => [
    `Editorial product photoshoot: model in an aspirational lifestyle setting with the physical product "${product}" naturally present — ${desc}.`,
    'Shot like a brand campaign — the physical product belongs in this world. Not a pitch, but a lifestyle association.',
    'Golden-hour or studio-simulated warm light. Styled environment with curated props and textures.',
    "Commercial photography quality — this is an ad that doesn't feel like an ad. Think Glossier, Aesop, or Apple product lifestyle shots.",
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
