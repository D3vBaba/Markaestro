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
 * Return product-type-aware subject direction for image generation.
 * Understands the product category and gives the AI relevant visual guidance.
 */
function getProductSubjectDirection(categories: string[], context: string): string {
  const is = (keywords: string[]) => keywords.some((k) => context.includes(k));

  // Fashion / Clothing / Apparel
  if (is(['fashion', 'clothing', 'apparel', 'wear', 'dress', 'outfit', 'shoe', 'sneaker', 'accessories', 'jewelry', 'bag', 'handbag'])) {
    return [
      'This is a FASHION/APPAREL product. Show the product being worn or styled in an aspirational setting.',
      'Editorial fashion photography: real fabrics, real textures, real movement. Show the garment/accessory as the hero.',
      'Lifestyle context: street style, studio lookbook, or curated flat-lay. Evoke the feeling of wearing this product.',
      'Do NOT show mannequins, generic product-on-white backgrounds, or tech imagery.',
    ].join('\n');
  }

  // Beauty / Skincare / Cosmetics
  if (is(['beauty', 'skincare', 'cosmetic', 'makeup', 'haircare', 'fragrance', 'perfume', 'serum', 'moisturizer'])) {
    return [
      'This is a BEAUTY/SKINCARE product. Show the product in a luxurious, tactile setting.',
      'Focus on texture: dewy skin, creamy product swatches, liquid pours, botanical ingredients.',
      'Clean beauty aesthetic with natural materials (marble, glass, botanicals). Soft, diffused lighting.',
      'Do NOT show tech imagery, screens, or generic stock photos.',
    ].join('\n');
  }

  // Food / Beverage / Restaurant
  if (is(['food', 'beverage', 'drink', 'restaurant', 'recipe', 'snack', 'coffee', 'tea', 'meal', 'kitchen', 'cooking', 'bakery', 'grocery'])) {
    return [
      'This is a FOOD/BEVERAGE product. Make it look absolutely irresistible.',
      'Food photography rules: overhead or 45-degree angle, natural window light, shallow depth of field.',
      'Show fresh ingredients, steam, condensation, drizzles — anything that makes it feel alive and delicious.',
      'Styled setting with complementary props (linens, utensils, herbs). Do NOT show tech imagery.',
    ].join('\n');
  }

  // Fitness / Health / Wellness
  if (is(['fitness', 'gym', 'workout', 'health', 'wellness', 'supplement', 'protein', 'yoga', 'sport', 'athletic'])) {
    return [
      'This is a FITNESS/WELLNESS product. Show energy, movement, and transformation.',
      'Dynamic composition: mid-action shots, sweat, determination, natural light in gym or outdoor setting.',
      'Focus on the feeling of strength and progress. Real bodies, authentic moments.',
      'Do NOT show static product shots on white background or tech imagery.',
    ].join('\n');
  }

  // Home / Interior / Furniture
  if (is(['home', 'interior', 'furniture', 'decor', 'candle', 'plant', 'living', 'bedroom', 'kitchen', 'garden', 'outdoor'])) {
    return [
      'This is a HOME/INTERIOR product. Show it in a beautifully styled living space.',
      'Interior photography: warm natural light, thoughtful styling, lived-in but aspirational.',
      'Show the product as part of a curated room vignette. Emphasize texture, warmth, and comfort.',
      'Do NOT show tech imagery or product-on-white isolated shots.',
    ].join('\n');
  }

  // Travel / Hospitality
  if (is(['travel', 'hotel', 'hospitality', 'tourism', 'vacation', 'resort', 'adventure', 'destination'])) {
    return [
      'This is a TRAVEL/HOSPITALITY product. Evoke wanderlust and the joy of discovery.',
      'Stunning landscapes, golden hour lighting, immersive perspectives. Show the experience, not just the place.',
      'Authentic travel moments: local culture, scenic vistas, cozy accommodations.',
      'Do NOT show tech imagery, screens, or generic stock travel photos.',
    ].join('\n');
  }

  // Education / Course / Learning
  if (is(['education', 'course', 'learning', 'teaching', 'tutorial', 'school', 'training', 'academy'])) {
    return [
      'This is an EDUCATION product. Show the transformation and empowerment that comes from learning.',
      'Aspirational imagery: confident people, creative workspaces, books, notebooks, collaborative moments.',
      'Warm, inviting aesthetic that makes learning feel exciting and accessible.',
      'Do NOT show generic classroom stock photos, phone screens, or tech cliches.',
    ].join('\n');
  }

  // Software / SaaS / Tech (only when explicitly categorized)
  if (is(['saas', 'software', 'mobile', 'web', 'api', 'platform', 'dashboard', 'analytics'])) {
    return [
      'This is a SOFTWARE product. Show the OUTCOME or TRANSFORMATION it delivers — the world users live in because of this product.',
      'Focus on the human benefit: productivity, creativity, connection, or insight.',
      'Do NOT show generic office scenes, random laptops, abstract tech patterns, or fake phone UIs.',
    ].join('\n');
  }

  // Default — generic but helpful direction
  return [
    'Show this product or its impact in an aspirational, real-world context.',
    'Focus on the feeling and lifestyle the product enables. Make the viewer want what they see.',
    'Use real textures, natural lighting, and authentic settings appropriate for this type of product.',
    'Do NOT default to tech imagery, phone screens, or laptop mockups unless this is explicitly a tech product.',
  ].join('\n');
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

  // ── 3. PRODUCT + SUBJECT — ground the image in what the product actually is ──
  {
    const productInfo: string[] = [];
    if (req.productName) productInfo.push(`Product: "${req.productName}"`);
    if (req.productDescription) productInfo.push(`Description: ${req.productDescription.slice(0, 300)}`);
    if (req.productCategories?.length) productInfo.push(`Type: ${req.productCategories.join(', ')}`);
    if (req.brandVoice?.targetAudience) productInfo.push(`Audience: ${req.brandVoice.targetAudience.slice(0, 200)}`);

    const categories = req.productCategories || [];
    const descLower = (req.productDescription || '').toLowerCase();
    const nameLower = (req.productName || '').toLowerCase();
    const context = `${categories.join(' ')} ${descLower} ${nameLower}`;

    // Truncate post content to avoid blowing up the prompt
    const postExcerpt = req.prompt.length > 400 ? req.prompt.slice(0, 400) + '...' : req.prompt;

    const lines: string[] = [];

    if (productInfo.length > 0) {
      lines.push('PRODUCT CONTEXT:', ...productInfo, '');
    }

    lines.push('SUBJECT: Create a marketing image specifically for this product.');

    // Product-type-aware visual direction
    const subjectDirection = getProductSubjectDirection(categories, context);
    lines.push(subjectDirection);

    lines.push(
      '',
      `Post angle: "${postExcerpt}"`,
      '',
      'Design a visual that communicates the core value proposition. Someone familiar with this product should immediately recognize the connection.',
    );

    sections.push(lines.join('\n'));
  }

  // Screenshots — phone mockups ONLY when user explicitly provides screenshots
  const hasScreenshots = req.screenUrls && req.screenUrls.length > 0;
  if (hasScreenshots) {
    const count = req.screenUrls!.length;
    sections.push([
      `APP SHOWCASE: Display the ${count} provided screenshot(s) on ${count === 1 ? 'a modern smartphone' : `${count} modern smartphones`}.`,
      'Show the provided screenshots EXACTLY as-is on the phone screens. Do NOT redraw or alter them.',
      'Modern frameless phone design, thin bezels, subtle shadow. Background: complementary gradient.',
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

  // ── TECHNICAL QUALITY + HARD CONSTRAINTS ──────────────────
  const hardConstraints = [
    'QUALITY: Sharp focus, professional color correction, slight film grain.',
    'NO text, words, or typography. NO watermarks.',
  ];

  if (!hasScreenshots) {
    hardConstraints.push(
      'CRITICAL: Do NOT show phone screens, laptop screens, device mockups, or any UI/UX screenshots. No screens of any kind.',
      'Do NOT show generic tech imagery: circuit boards, holographic UIs, abstract network nodes, code editors.',
    );
  }

  sections.push(hardConstraints.join('\n'));

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
    const errMsg = data.error?.message || JSON.stringify(data).slice(0, 500);
    console.error('[Gemini] API error:', response.status, errMsg);
    throw new Error(`Gemini API error: ${errMsg}`);
  }

  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) {
    const finishReason = data.candidates?.[0]?.finishReason;
    const safetyRatings = data.candidates?.[0]?.safetyRatings;
    console.error('[Gemini] No content parts. finishReason:', finishReason, 'safety:', JSON.stringify(safetyRatings));
    throw new Error(`No image generated by Gemini (reason: ${finishReason || 'unknown'})`);
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
 * Generate a realistic AI face image for UGC avatar use.
 * Returns a public URL to the uploaded image.
 */
export async function generateFaceAvatar(
  workspaceId: string,
  options?: {
    gender?: 'male' | 'female';
    ageRange?: 'young adult' | 'adult' | 'middle aged';
    ethnicity?: string;
    /** Product context to match the avatar's look to the brand */
    productName?: string;
    productDescription?: string;
    productCategories?: string[];
    targetAudience?: string;
    brandTone?: string;
  },
): Promise<{ imageUrl: string }> {
  const gender = options?.gender || (Math.random() > 0.5 ? 'female' : 'male');
  const age = options?.ageRange || 'young adult';
  const ethnicity = options?.ethnicity || '';

  // Build product-aware styling
  const productContext: string[] = [];
  if (options?.productName) productContext.push(`This person is a content creator for "${options.productName}".`);
  if (options?.productDescription) productContext.push(`The product: ${options.productDescription.slice(0, 200)}`);
  if (options?.targetAudience) productContext.push(`Target audience: ${options.targetAudience}`);

  // Derive aesthetic from product category
  let aestheticDirection = 'Clean, modern casual style.';
  const cats = (options?.productCategories || []).join(' ').toLowerCase();
  const desc = (options?.productDescription || '').toLowerCase();
  const context = `${cats} ${desc}`;

  if (/fashion|clothing|apparel|wear|style|outfit/.test(context)) {
    aestheticDirection = 'Fashion-forward styling: trendy outfit, styled hair, curated accessories. This person looks like a fashion influencer — aspirational but relatable. Think curated Instagram aesthetic.';
  } else if (/beauty|skincare|cosmetic|makeup/.test(context)) {
    aestheticDirection = 'Glowing, dewy skin with subtle, polished makeup. Clean beauty aesthetic — natural but intentional. Fresh, well-groomed hair. This person looks like a skincare/beauty creator.';
  } else if (/fitness|gym|workout|health|wellness|sport/.test(context)) {
    aestheticDirection = 'Athletic, healthy appearance. Clean workout attire or athleisure. Energetic expression, natural glow. This person looks like a fitness creator — toned, confident, active lifestyle.';
  } else if (/food|beverage|recipe|restaurant|cooking/.test(context)) {
    aestheticDirection = 'Warm, inviting appearance. Casual apron or kitchen-ready look. Friendly, approachable energy. This person looks like a food creator — the kind of person you\'d trust with a recipe.';
  } else if (/tech|saas|software|mobile|web|app|api/.test(context)) {
    aestheticDirection = 'Clean, minimalist tech-professional look. Smart casual — maybe a quality plain tee or button-down. Modern workspace or clean background. This person looks like a tech reviewer or product creator.';
  } else if (/education|course|learning|tutorial/.test(context)) {
    aestheticDirection = 'Smart, approachable, slightly bookish. Glasses optional. Warm lighting, study or library-type background. This person looks like a knowledgeable creator who teaches things clearly.';
  } else if (/travel|hotel|adventure|tourism/.test(context)) {
    aestheticDirection = 'Sun-kissed, adventurous look. Casual travel wear, natural windswept hair. Outdoor golden-hour lighting. This person looks like a travel creator sharing discoveries.';
  }

  if (options?.brandTone) {
    productContext.push(`Brand tone is "${options.brandTone}" — the person's vibe should match.`);
  }

  const prompt = [
    `Portrait photograph of a ${age} ${ethnicity ? ethnicity + ' ' : ''}${gender}, looking directly at the camera with a confident, approachable expression.`,
    'Shot on iPhone 15 Pro, natural daylight, shallow depth of field with softly blurred background.',
    aestheticDirection,
    ...productContext,
    'Natural skin texture, no heavy retouching. Genuine expression — slight smile or confident look.',
    'Head and shoulders framing, vertical portrait orientation.',
    'This should look like a real TikTok creator who genuinely uses and loves this product — NOT a stock photo or generic AI face.',
    'No text, no watermarks, no logos.',
  ].join('\n');

  const result = await generateWithGemini(prompt, '3:4');
  const imageUrl = await uploadToFirebaseStorage(result.base64, result.mimeType, workspaceId);
  return { imageUrl };
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
