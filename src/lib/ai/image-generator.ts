import crypto from 'crypto';
import type { BrandIdentity, BrandVoice, ImageStyle, ImageAspectRatio, ImageProvider } from '@/lib/schemas';
import { fetchWithRetry } from '@/lib/fetch-retry';

export type ImageGenRequest = {
  prompt: string;
  brandIdentity?: BrandIdentity;
  brandVoice?: BrandVoice;
  productName?: string;
  style: ImageStyle;
  aspectRatio: ImageAspectRatio;
  provider: ImageProvider;
  /** URLs of app screenshots to render inside phone mockups */
  screenUrls?: string[];
  /** URL of the product logo to include in the image */
  logoUrl?: string;
};

export type ImageGenResult = {
  imageUrl: string;
  provider: ImageProvider;
  revisedPrompt?: string;
};

/** Pixel dimensions for each aspect ratio */
const ASPECT_RATIO_DIMENSIONS: Record<ImageAspectRatio, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1792, height: 1024 },
  '9:16': { width: 1024, height: 1792 },
  '4:5': { width: 1024, height: 1280 },
};

/**
 * Build a prompt that incorporates brand identity and produces studio-quality images.
 */
function buildBrandedPrompt(req: ImageGenRequest): string {
  const parts: string[] = [];

  const dims = ASPECT_RATIO_DIMENSIONS[req.aspectRatio];

  // Style instruction with studio-quality photography direction
  const styleMap: Record<ImageStyle, string> = {
    photorealistic: 'Shot on iPhone 17 Pro Max, 48MP main camera, ProRAW. Ultra-realistic photograph with natural lighting, shallow depth of field, cinematic color grading. Studio-quality editorial image',
    illustration: 'Premium digital illustration with rich detail, professional-grade vector art quality, vibrant colors, clean composition',
    minimal: 'Clean minimalist design, elegant negative space, precise typography-friendly layout, premium aesthetic with subtle gradients',
    abstract: 'High-end abstract composition with sophisticated color palette, artistic textures, dynamic visual flow, gallery-quality',
    branded: 'Professional commercial photography, studio lighting setup, product-shot quality, advertising-grade image with premium feel',
  };
  parts.push(styleMap[req.style] || styleMap.branded);

  // Aspect ratio and size instruction
  parts.push(`Output image must be exactly ${dims.width}x${dims.height} pixels (${req.aspectRatio} aspect ratio).`);

  // Phone mockup instructions when screenshots are provided
  if (req.screenUrls && req.screenUrls.length > 0) {
    const count = req.screenUrls.length;
    parts.push(
      `Feature ${count === 1 ? 'a modern smartphone' : `${count} modern smartphones`} in the composition.` +
      ` Each phone screen must display the provided app screenshot(s) exactly as given — do NOT alter, redraw, or reinterpret the screen content.` +
      ` The phones should have thin bezels, realistic reflections, and be angled attractively.` +
      ` Place the phone${count > 1 ? 's' : ''} as the focal point of the marketing image.`
    );
  }

  // Logo instructions
  if (req.logoUrl) {
    parts.push(
      'Include the provided logo in the image. Place it prominently but tastefully — corner placement, watermark-style, or integrated into the design. Reproduce the logo exactly as provided, do NOT alter or redraw it.'
    );
  }

  // Main prompt
  parts.push(`depicting: ${req.prompt}.`);

  // Product name
  if (req.productName) {
    parts.push(`This is marketing content for "${req.productName}".`);
  }

  // Brand colors
  if (req.brandIdentity) {
    const colors: string[] = [];
    if (req.brandIdentity.primaryColor) colors.push(`primary color ${req.brandIdentity.primaryColor}`);
    if (req.brandIdentity.secondaryColor) colors.push(`secondary color ${req.brandIdentity.secondaryColor}`);
    if (req.brandIdentity.accentColor) colors.push(`accent color ${req.brandIdentity.accentColor}`);
    if (colors.length > 0) {
      parts.push(`Incorporate the brand color palette: ${colors.join(', ')}.`);
    }
  }

  // Brand voice tone
  if (req.brandVoice?.tone) {
    parts.push(`The visual mood should convey a ${req.brandVoice.tone} feeling.`);
  }

  // Quality boosters
  parts.push('8K resolution, sharp focus, professional color correction, social media ready, high dynamic range, no artifacts, no watermarks.');

  return parts.join(' ');
}

/**
 * Download an image URL and return its base64 data and mime type.
 */
async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetchWithRetry(url, undefined, { timeoutMs: 15_000 });
  if (!res.ok) throw new Error(`Failed to fetch image: ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/png';
  return { base64: buffer.toString('base64'), mimeType: contentType };
}

/**
 * Generate image using Gemini 3.1 Flash — supports multimodal input (logo + screenshots).
 */
async function generateWithGemini(
  prompt: string,
  _aspectRatio: ImageAspectRatio,
  referenceImages?: { base64: string; mimeType: string }[],
): Promise<{ base64: string; mimeType: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  // Build multimodal content parts
  const contentParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  // Add reference images first (logo and screenshots)
  if (referenceImages && referenceImages.length > 0) {
    for (const img of referenceImages) {
      contentParts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.base64,
        },
      });
    }
  }

  // Add the text prompt
  contentParts.push({ text: prompt });

  const response = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: contentParts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Gemini API error: ${data.error?.message || JSON.stringify(data)}`);
  }

  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) {
    throw new Error('No content in Gemini response');
  }

  const imagePart = parts.find((p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData);
  if (!imagePart?.inlineData) {
    throw new Error('No image generated by Gemini');
  }

  return {
    base64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || 'image/png',
  };
}

/**
 * Generate image using OpenAI DALL-E 3.
 */
async function generateWithOpenAI(prompt: string, aspectRatio: ImageAspectRatio): Promise<{ base64: string; mimeType: string; revisedPrompt?: string }> {
  const OpenAI = (await import('openai')).default;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const openai = new OpenAI({ apiKey });

  // Map aspect ratios to DALL-E sizes
  const sizeMap: Record<ImageAspectRatio, '1024x1024' | '1792x1024' | '1024x1792'> = {
    '1:1': '1024x1024',
    '16:9': '1792x1024',
    '9:16': '1024x1792',
    '4:5': '1024x1024',
  };

  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: sizeMap[aspectRatio],
    response_format: 'url',
    quality: 'hd',
  });

  const imageData = response.data?.[0];
  if (!imageData?.url) {
    throw new Error('No image URL in OpenAI response');
  }

  const imgRes = await fetchWithRetry(imageData.url);
  if (!imgRes.ok) throw new Error('Failed to download image from OpenAI');
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  return {
    base64: buffer.toString('base64'),
    mimeType: 'image/png',
    revisedPrompt: imageData.revised_prompt ?? undefined,
  };
}

/**
 * Upload base64 image to Firebase Storage and return a signed URL.
 */
async function uploadToFirebaseStorage(
  base64: string,
  mimeType: string,
  workspaceId: string,
): Promise<string> {
  const admin = await import('firebase-admin');
  const bucket = admin.storage().bucket();

  const fileId = crypto.randomUUID();
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const filePath = `workspaces/${workspaceId}/generated/${fileId}.${ext}`;
  const file = bucket.file(filePath);

  const buffer = Buffer.from(base64, 'base64');

  await file.save(buffer, {
    metadata: {
      contentType: mimeType,
      metadata: {
        workspaceId,
        generatedAt: new Date().toISOString(),
      },
    },
  });

  // Make the file publicly readable and return a direct URL
  await file.makePublic();
  const bucketName = bucket.name;
  return `https://storage.googleapis.com/${bucketName}/${filePath}`;
}

/**
 * Generate an image using the specified provider, with fallback.
 * Tries Gemini 3.1 Flash first, falls back to OpenAI DALL-E 3.
 */
export async function generateImage(req: ImageGenRequest): Promise<{ base64: string; mimeType: string; provider: ImageProvider; revisedPrompt?: string }> {
  const prompt = buildBrandedPrompt(req);

  // Fetch reference images (logo + screenshots) for Gemini multimodal input
  const referenceImages: { base64: string; mimeType: string }[] = [];
  const imageUrls: string[] = [];

  if (req.logoUrl) imageUrls.push(req.logoUrl);
  if (req.screenUrls) imageUrls.push(...req.screenUrls);

  if (imageUrls.length > 0) {
    const fetched = await Promise.allSettled(
      imageUrls.map((url) => fetchImageAsBase64(url)),
    );
    for (const result of fetched) {
      if (result.status === 'fulfilled') {
        referenceImages.push(result.value);
      } else {
        console.warn('Failed to fetch reference image:', result.reason);
      }
    }
  }

  if (req.provider === 'gemini') {
    try {
      const result = await generateWithGemini(
        prompt,
        req.aspectRatio,
        referenceImages.length > 0 ? referenceImages : undefined,
      );
      return { ...result, provider: 'gemini' };
    } catch (e) {
      console.error('Gemini image generation failed, falling back to OpenAI:', e);
    }
  }

  // OpenAI (primary or fallback) — DALL-E doesn't support reference images
  const result = await generateWithOpenAI(prompt, req.aspectRatio);
  return {
    base64: result.base64,
    mimeType: result.mimeType,
    provider: 'openai',
    revisedPrompt: result.revisedPrompt,
  };
}

/**
 * Full pipeline: generate image + upload to Firebase Storage.
 */
export async function generateAndUploadImage(
  req: ImageGenRequest,
  workspaceId: string,
): Promise<ImageGenResult> {
  const result = await generateImage(req);
  const imageUrl = await uploadToFirebaseStorage(result.base64, result.mimeType, workspaceId);

  return {
    imageUrl,
    provider: result.provider,
    revisedPrompt: result.revisedPrompt,
  };
}
