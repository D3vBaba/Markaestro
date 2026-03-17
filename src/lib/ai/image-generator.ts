import crypto from 'crypto';
import type { BrandIdentity, BrandVoice, ImageStyle, ImageAspectRatio, ImageProvider, SocialChannel } from '@/lib/schemas';
import { fetchWithRetry } from '@/lib/fetch-retry';

export type ImageGenRequest = {
  prompt: string;
  brandIdentity?: BrandIdentity;
  brandVoice?: BrandVoice;
  productName?: string;
  /** What the product actually is / does */
  productDescription?: string;
  /** Product categories like saas, mobile, web, etc. */
  productCategories?: string[];
  /** Product website URL */
  productUrl?: string;
  /** Target social channel — drives platform-specific visual direction */
  channel?: SocialChannel;
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

/**
 * Platform-specific visual direction based on engagement research.
 * Each platform has different content that drives saves, shares, and scroll-stops.
 */
function getPlatformDirection(channel?: SocialChannel): string {
  switch (channel) {
    case 'x':
      return [
        'PLATFORM: X/Twitter — this image must stop the scroll in a fast-moving text-heavy feed.',
        'COMPOSITION: Bold, high-contrast image that pops against a dark interface. Use warm tones (reds, oranges, golds) which get 25% more engagement on X. Single focal point, no clutter.',
        'WHAT WORKS: Data visualizations, bold typography-style graphics, striking single-subject compositions, dramatic close-ups with rich texture. Think infographic-meets-art.',
        'FRAMING: Landscape 16:9 composition. Key visual in the center — X crops edges in preview.',
      ].join('\n');
    case 'facebook':
      return [
        'PLATFORM: Facebook — this image needs to earn shares and comments in the feed.',
        'COMPOSITION: Bright, warm, and energetic. Golden yellows, warm oranges, and violet tones increase engagement on Facebook. High contrast between elements.',
        'WHAT WORKS: Emotionally resonant imagery, community-feel compositions, vibrant lifestyle moments, or bold single-insight visuals. Carousel-friendly if multiple concepts.',
        'FRAMING: Square or slightly portrait composition. Mobile-first — 98% of Facebook users are on mobile.',
      ].join('\n');
    case 'instagram':
      return [
        'PLATFORM: Instagram — this image must be save-worthy and visually cohesive.',
        'COMPOSITION: Clean, bright, and editorial. Blue-dominant images outperform warm tones on Instagram. Use a neutral base (whites, creams) with one strong accent color. Generous negative space.',
        'WHAT WORKS: Minimalist aesthetic with texture, behind-the-scenes authenticity, educational single-insight visuals, or aspirational lifestyle. Static images outperform video for engagement.',
        'FRAMING: Portrait 4:5 composition to maximize screen real estate. Design with the 3:4 grid crop in mind — keep key elements in the center.',
      ].join('\n');
    case 'tiktok':
      return [
        'PLATFORM: TikTok — this image needs to feel native, authentic, and bold.',
        'COMPOSITION: High-energy, lo-fi authentic feel over polished perfection. Bold colors, strong contrast that reads at tiny thumbnail sizes. Center key visual in the middle 60% of the frame.',
        'WHAT WORKS: Raw, authentic aesthetic — the "quiet flex" style. Aspirational but calm. Confident, intentional visuals over loud flashy content. Bright, well-lit, and clear.',
        'FRAMING: Full vertical 9:16 composition. Keep text/key elements away from top 150px and bottom 250px (UI overlays).',
      ].join('\n');
    default:
      return 'PLATFORM: General social media — bright, bold, scroll-stopping composition with strong focal point.';
  }
}

/**
 * Build a prompt using Gemini's recommended 5-component structure:
 * Style → Subject → Setting → Action → Composition
 *
 * Uses post text as creative INSPIRATION, not literal description.
 * Platform-specific visual strategies based on engagement data.
 */
function buildBrandedPrompt(req: ImageGenRequest): string {
  const sections: string[] = [];

  // ── 1. STYLE ──────────────────────────────────────────────
  const styleMap: Record<ImageStyle, string> = {
    photorealistic: [
      'STYLE: Cinematic editorial photograph shot on Hasselblad X2D, 90mm f/3.2 lens.',
      'Natural skin texture with pores and slight imperfections. Single directional light source creating defined shadows.',
      'Subtle film grain, natural sensor noise. Warm color grading with lifted shadows.',
      'Shallow depth of field with creamy bokeh. Looks like a Condé Nast editorial, NOT a stock photo.',
    ].join(' '),
    illustration: [
      'STYLE: Bold editorial illustration with hand-crafted quality.',
      'Limited palette — maximum 4-5 intentional colors. Strong graphic shapes and confident linework.',
      'Visible texture and imperfection — risograph grain, screen-print quality, or watercolor bleeds.',
      'Clever visual metaphor over literal depiction. Feels like a New Yorker cover or Pentagram poster.',
    ].join(' '),
    minimal: [
      'STYLE: High-end minimalist composition.',
      'One hero element surrounded by vast negative space. Maximum two colors plus neutrals.',
      'Precise geometry, clean edges, intentional asymmetry. Japanese design sensibility.',
      'Every element earns its place. The whitespace is as important as the subject.',
    ].join(' '),
    abstract: [
      'STYLE: Contemporary abstract art — gallery quality.',
      'Organic flowing shapes intersecting geometric elements. Rich layered textures with depth.',
      'Bold saturated color fields with sophisticated complementary palette.',
      'Dynamic tension and visual rhythm. Painterly quality with sharp details. Could hang in a gallery.',
    ].join(' '),
    branded: [
      'STYLE: Premium brand campaign — lifestyle editorial quality.',
      'Shot on Canon EOS R5, 35mm f/1.4 lens. Natural window lighting or golden hour.',
      'Warm, inviting color palette. Authentic textures — linen, wood, ceramic, concrete.',
      'Aspirational but approachable. Think Aesop, Glossier, or Notion brand aesthetic.',
    ].join(' '),
  };
  sections.push(styleMap[req.style] || styleMap.branded);

  // ── 2. PLATFORM DIRECTION ──────────────────────────────────
  sections.push(getPlatformDirection(req.channel));

  // ── 3. PRODUCT CONTEXT — ground the image in what the product actually is ──
  {
    const productLines: string[] = [];

    if (req.productName) {
      productLines.push(`PRODUCT NAME: "${req.productName}"`);
    }

    if (req.productDescription) {
      productLines.push(`WHAT IT DOES: ${req.productDescription}`);
    }

    if (req.productCategories && req.productCategories.length > 0) {
      productLines.push(`PRODUCT TYPE: ${req.productCategories.join(', ')}`);
    }

    if (req.productUrl) {
      productLines.push(`WEBSITE: ${req.productUrl}`);
    }

    if (req.brandVoice?.targetAudience) {
      productLines.push(`TARGET AUDIENCE: ${req.brandVoice.targetAudience}`);
    }

    if (productLines.length > 0) {
      sections.push([
        'PRODUCT RESEARCH — Read this carefully before designing:',
        ...productLines,
        '',
        'You MUST design the image specifically for THIS product. The image should make someone who knows the product say "yes, that image is clearly about [product name]".',
        'Do NOT create a generic stock-photo-style image. The image must be unmistakably tied to what this product does and who it serves.',
      ].join('\n'));
    }
  }

  // ── 4. SUBJECT — derive the visual concept from the product + post ──
  {
    const isSoftware = req.productCategories?.some((c) =>
      ['saas', 'mobile', 'web', 'api'].includes(c),
    );

    const subjectLines: string[] = [
      'SUBJECT: Design a marketing visual that communicates the CORE VALUE of this product.',
    ];

    if (isSoftware) {
      subjectLines.push(
        'This is a SOFTWARE product. Do NOT show generic office scenes, random people at laptops, or abstract tech patterns.',
        'Instead, show the TRANSFORMATION or OUTCOME the software delivers:',
        '- If it helps teams collaborate → show the feeling of seamless teamwork, connected workflows',
        '- If it automates tasks → show the relief/freedom of time saved, the before/after contrast',
        '- If it provides analytics → show clarity, insight, the "aha moment" of understanding data',
        '- If it is a mobile app → show the lifestyle context where someone would pull out their phone to use it',
        'The visual should answer: "What does the user\'s life look like BECAUSE they use this product?"',
      );
    } else {
      subjectLines.push(
        'Show the product or its impact in an aspirational, real-world context.',
        'The viewer should feel desire or curiosity — "I want that" or "I need to know more".',
      );
    }

    subjectLines.push(
      '',
      `POST CONTENT (use this to understand the specific angle/message — do NOT just illustrate these words literally):`,
      `"${req.prompt}"`,
      '',
      'Extract the CORE CLAIM or VALUE PROPOSITION from the post, then design a visual metaphor or scene that communicates it.',
    );

    sections.push(subjectLines.join('\n'));
  }

  // ── 5. SETTING & CONTEXT ──────────────────────────────────
  if (req.productName) {
    sections.push(`BRAND WORLD: This image lives in the universe of "${req.productName}". It should feel like it belongs on their website, app store listing, or social feed — not like a random stock photo with their name on it.`);
  }

  // Screenshots override — only when user explicitly uploads them
  if (req.screenUrls && req.screenUrls.length > 0) {
    const count = req.screenUrls.length;
    const productContext = req.productName
      ? ` These are real screenshots from "${req.productName}".`
      : '';
    sections.push([
      `APP SHOWCASE MODE: The user has provided ${count} actual screenshot(s) from their app.${productContext}`,
      `Feature ${count === 1 ? 'one smartphone' : `${count} smartphones`} displaying the provided screenshot(s) EXACTLY as-is on screen.`,
      'CRITICAL: The screenshots are the PROVIDED IMAGES — display them pixel-perfect on the phone screens. Do NOT redraw, alter, or replace the UI shown in the screenshots.',
      'The phone(s) should be the hero element — modern frameless design, thin bezels, subtle shadow.',
      req.productDescription
        ? `Design the background to complement what "${req.productName}" does: ${req.productDescription}. Use colors, patterns, or abstract elements that relate to the product category.`
        : 'Background: soft gradient or atmospheric blur that complements the app\'s color scheme.',
      'Do NOT show generic/random app interfaces — the provided screenshots are the ONLY content that should appear on the phone screens.',
    ].join('\n'));
  }

  // Logo — subtle integration only
  if (req.logoUrl) {
    sections.push('LOGO: Place the provided logo subtly — small, in a corner, semi-transparent. It should NOT dominate the composition.');
  }

  // ── 5. BRAND COLORS ───────────────────────────────────────
  if (req.brandIdentity) {
    const colors: string[] = [];
    if (req.brandIdentity.primaryColor) colors.push(req.brandIdentity.primaryColor);
    if (req.brandIdentity.secondaryColor) colors.push(req.brandIdentity.secondaryColor);
    if (req.brandIdentity.accentColor) colors.push(req.brandIdentity.accentColor);
    if (colors.length > 0) {
      sections.push(`COLOR PALETTE: Weave these brand colors as accent tones: ${colors.join(', ')}. Use them for highlights, reflections, or atmospheric color — NOT as flat fills.`);
    }
  }

  // Brand voice mood
  if (req.brandVoice?.tone) {
    sections.push(`MOOD: The image should evoke a ${req.brandVoice.tone} feeling.`);
  }

  // ── TECHNICAL QUALITY ───────────────────────────────────
  sections.push([
    'QUALITY: Sharp focus, natural depth of field, professional color correction, slight film grain.',
    'RULES:',
    '- NO text, words, letters, or typography in the image',
    '- NO watermarks or UI elements',
    '- Natural skin texture if people are shown — no plastic/waxy AI look',
    '- The image MUST be specifically about THIS product — if someone who uses the product saw this image, they should immediately recognize it relates to their product',
    '- Do NOT show random phone screens with fake/generic UIs unless the user provided actual screenshots',
    '- Do NOT show generic "person at laptop" or "team in office" scenes unless they specifically relate to the product\'s use case',
    '- Avoid cliché tech imagery: glowing circuit boards, abstract network nodes, floating holographic UIs',
  ].join('\n'));

  return sections.join('\n\n');
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
  aspectRatio: ImageAspectRatio,
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
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: contentParts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: {
            aspectRatio,
            imageSize: '2K',
          },
        },
      }),
    },
    { timeoutMs: 120_000, maxRetries: 1 },
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

  // Map aspect ratios to closest DALL-E 3 sizes (only supports 1024x1024, 1792x1024, 1024x1792)
  const sizeMap: Record<ImageAspectRatio, '1024x1024' | '1792x1024' | '1024x1792'> = {
    '1:1': '1024x1024',
    '16:9': '1792x1024',
    '9:16': '1024x1792',
    '4:5': '1024x1792',
    '3:4': '1024x1792',
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
    const result = await generateWithGemini(
      prompt,
      req.aspectRatio,
      referenceImages.length > 0 ? referenceImages : undefined,
    );
    return { ...result, provider: 'gemini' };
  }

  // OpenAI — only used when explicitly selected as provider
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
