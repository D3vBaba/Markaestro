/**
 * 20 pre-defined character model specs.
 *
 * Each spec defines the generation prompt and metadata for one character model.
 * These specs are used by the seed script (scripts/seed-character-models.ts) to
 * generate reference images via Gemini and write them to Firestore + Storage.
 *
 * Diversity matrix:
 *   - 5 ethnicities: Black, East Asian, South Asian, Latina/Hispanic, White
 *   - 2 genders per ethnicity: female + male (with 2 nonbinary additions)
 *   - 2 age ranges: 18–25 (younger) and 26–40 (adult)
 *   - 3 style clusters: casual/lifestyle, professional, fitness
 *   - Body size varies throughout — 6 of 20 are average/plus builds
 *
 * Generation prompt format:
 *   Used as the Gemini image generation prompt for the reference hero shots.
 *   These are portrait shots (upper body, clear face) on neutral backgrounds
 *   — optimised to serve as character consistency reference images.
 */

export type CharacterModelSpec = {
  id: string;
  name: string;
  description: string;
  gender: 'female' | 'male' | 'nonbinary';
  ageRange: '18-25' | '26-35' | '36-50' | '51+';
  ethnicity: string;
  bodySize: 'slim' | 'average' | 'plus';
  style: 'casual' | 'professional' | 'fitness' | 'lifestyle' | 'streetwear';
  generationPrompt: string;
};

export const CHARACTER_MODEL_SPECS: CharacterModelSpec[] = [
  // ── Black Female ──────────────────────────────────────────────────
  {
    id: 'nia',
    name: 'Nia',
    description: 'Early 20s Black woman, casual lifestyle',
    gender: 'female',
    ageRange: '18-25',
    ethnicity: 'Black',
    bodySize: 'slim',
    style: 'casual',
    generationPrompt: 'Portrait photo of a young Black woman in her early 20s, natural 4C hair styled in a puff, warm brown skin, relaxed smile, wearing a cream cropped sweatshirt and gold hoop earrings. Upper body portrait, soft natural window light from the left, slightly warm color temperature. Neutral light grey background. Sharp focus on her face, shallow depth of field. Authentic, candid, not posed. No text, no logos.',
  },
  {
    id: 'marcus',
    name: 'Marcus',
    description: 'Late 20s Black man, professional',
    gender: 'male',
    ageRange: '26-35',
    ethnicity: 'Black',
    bodySize: 'average',
    style: 'professional',
    generationPrompt: 'Portrait photo of a Black man in his late 20s, close-cropped hair with a fade, deep brown skin, confident expression with a subtle smile, wearing a fitted dark navy button-up shirt. Upper body portrait, clean studio lighting with soft directional light from the right. Neutral off-white background. Sharp focus on face. Professional yet approachable energy. No text, no logos.',
  },

  // ── East Asian Female ─────────────────────────────────────────────
  {
    id: 'mei',
    name: 'Mei',
    description: 'Early 20s East Asian woman, streetwear style',
    gender: 'female',
    ageRange: '18-25',
    ethnicity: 'East Asian',
    bodySize: 'slim',
    style: 'streetwear',
    generationPrompt: 'Portrait photo of a young East Asian woman in her early 20s, straight black hair with subtle curtain bangs, fair skin with warm undertones, playful expression, wearing an oversized graphic hoodie and small silver stud earrings. Upper body portrait, cool urban ambient light, slight cinematic look. Soft blurred neutral background. Sharp focus on face, authentic Gen-Z energy. No text, no logos.',
  },
  {
    id: 'kevin',
    name: 'Kevin',
    description: 'Early 30s East Asian man, fitness',
    gender: 'male',
    ageRange: '26-35',
    ethnicity: 'East Asian',
    bodySize: 'slim',
    style: 'fitness',
    generationPrompt: 'Portrait photo of an East Asian man in his early 30s, short neat hair, warm medium skin tone, focused athletic expression, wearing a fitted grey athletic performance shirt with subtle texture. Upper body portrait, bright clean gym or outdoor light, sharp shadows. Neutral pale background. Athletic, healthy, determined look. No text, no logos.',
  },

  // ── South Asian Female ────────────────────────────────────────────
  {
    id: 'priya',
    name: 'Priya',
    description: 'Mid 20s South Asian woman, professional',
    gender: 'female',
    ageRange: '26-35',
    ethnicity: 'South Asian',
    bodySize: 'average',
    style: 'professional',
    generationPrompt: 'Portrait photo of a South Asian woman in her mid 20s, long dark brown hair pulled back in a low bun, medium warm skin tone, confident warm smile, wearing a tailored burgundy blazer over a simple white top. Upper body portrait, warm professional office lighting. Clean cream background. Sharp focus on face, poised and approachable. No text, no logos.',
  },
  {
    id: 'arjun',
    name: 'Arjun',
    description: 'Late 20s South Asian man, casual lifestyle',
    gender: 'male',
    ageRange: '26-35',
    ethnicity: 'South Asian',
    bodySize: 'slim',
    style: 'casual',
    generationPrompt: 'Portrait photo of a South Asian man in his late 20s, slightly wavy dark hair, warm brown skin, relaxed genuine smile, wearing a soft earth-tone henley shirt. Upper body portrait, warm natural afternoon light, golden hour tone. Blurred warm indoor background. Casual, friendly, trustworthy energy. No text, no logos.',
  },

  // ── Latina / Hispanic Female ──────────────────────────────────────
  {
    id: 'sofia',
    name: 'Sofia',
    description: 'Early 20s Latina woman, lifestyle',
    gender: 'female',
    ageRange: '18-25',
    ethnicity: 'Latina',
    bodySize: 'average',
    style: 'lifestyle',
    generationPrompt: 'Portrait photo of a young Latina woman in her early 20s, long wavy dark hair with honey highlights, olive-warm skin tone, bright expressive smile, wearing a floral summer top with small gold jewelry. Upper body portrait, warm outdoor natural light, slight dappled sunlight effect. Soft blurred green/warm background. Vibrant, joyful, authentic energy. No text, no logos.',
  },
  {
    id: 'diego',
    name: 'Diego',
    description: 'Late 20s Latino man, streetwear',
    gender: 'male',
    ageRange: '26-35',
    ethnicity: 'Latino',
    bodySize: 'slim',
    style: 'streetwear',
    generationPrompt: 'Portrait photo of a Latino man in his late 20s, dark hair with a textured fade, medium-warm tan skin, cool confident expression with a slight smirk, wearing a clean white oversized tee and a thin gold chain. Upper body portrait, warm urban natural light, slightly stylized look. Neutral urban background softly blurred. Stylish, confident, approachable. No text, no logos.',
  },

  // ── White Female ──────────────────────────────────────────────────
  {
    id: 'emma',
    name: 'Emma',
    description: 'Early 20s white woman, casual UGC style',
    gender: 'female',
    ageRange: '18-25',
    ethnicity: 'White',
    bodySize: 'slim',
    style: 'casual',
    generationPrompt: 'Portrait photo of a young white woman in her early 20s, shoulder-length blonde hair with natural waves, fair skin with light freckles, genuine unguarded smile, wearing a light blue oversized denim shirt. Upper body portrait, soft natural window light, slightly lo-fi organic feel. Neutral warm background. Relatable, authentic, friend-next-door energy. No text, no logos.',
  },
  {
    id: 'james',
    name: 'James',
    description: 'Early 30s white man, professional',
    gender: 'male',
    ageRange: '26-35',
    ethnicity: 'White',
    bodySize: 'average',
    style: 'professional',
    generationPrompt: 'Portrait photo of a white man in his early 30s, medium brown hair neatly styled, fair complexion, calm trustworthy expression, wearing a crisp light grey fitted crew-neck sweater. Upper body portrait, clean soft studio lighting, even illumination. Neutral white/light background. Competent, calm, professional energy. No text, no logos.',
  },

  // ── Additional diversity: plus-size, older, nonbinary ─────────────
  {
    id: 'zara',
    name: 'Zara',
    description: '30s Black plus-size woman, professional lifestyle',
    gender: 'female',
    ageRange: '26-35',
    ethnicity: 'Black',
    bodySize: 'plus',
    style: 'lifestyle',
    generationPrompt: 'Portrait photo of a Black woman in her early 30s, plus-size, wearing a deep emerald wrap blouse, natural hair styled in locs, medium-dark skin, radiant confident smile. Upper body portrait, warm natural light from a large window. Clean neutral background. Powerful, beautiful, confident energy. No text, no logos.',
  },
  {
    id: 'lena',
    name: 'Lena',
    description: 'Mid 30s white plus-size woman, casual warm',
    gender: 'female',
    ageRange: '26-35',
    ethnicity: 'White',
    bodySize: 'plus',
    style: 'casual',
    generationPrompt: 'Portrait photo of a white woman in her mid 30s, plus-size, warm strawberry-blonde hair in a loose braid, pink fair skin, warm genuine smile, wearing a cosy rust-orange knit sweater. Upper body portrait, warm morning window light. Soft blurred domestic background. Warm, relatable, comforting energy. No text, no logos.',
  },
  {
    id: 'ray',
    name: 'Ray',
    description: 'Mid 20s nonbinary East Asian person, streetwear',
    gender: 'nonbinary',
    ageRange: '18-25',
    ethnicity: 'East Asian',
    bodySize: 'slim',
    style: 'streetwear',
    generationPrompt: 'Portrait photo of a young East Asian nonbinary person in their mid 20s, short asymmetric dyed dark-violet hair, pale skin, expressive direct gaze, wearing a structured black oversized jacket with a simple white tee underneath. Upper body portrait, cool desaturated studio light with one pop of warm accent. Neutral dark grey background. Bold, artistic, gender-fluid energy. No text, no logos.',
  },
  {
    id: 'alex',
    name: 'Alex',
    description: 'Early 30s nonbinary white person, casual professional',
    gender: 'nonbinary',
    ageRange: '26-35',
    ethnicity: 'White',
    bodySize: 'slim',
    style: 'professional',
    generationPrompt: 'Portrait photo of a white nonbinary person in their early 30s, short natural brown hair, medium fair skin with subtle freckles, warm open expression, wearing a soft grey blazer over a sage green crewneck. Upper body portrait, soft diffused natural light. Neutral warm white background. Confident, approachable, modern professional energy. No text, no logos.',
  },

  // ── Fitness specialists ───────────────────────────────────────────
  {
    id: 'jade',
    name: 'Jade',
    description: 'Early 20s Latina fitness woman',
    gender: 'female',
    ageRange: '18-25',
    ethnicity: 'Latina',
    bodySize: 'slim',
    style: 'fitness',
    generationPrompt: 'Portrait photo of a young Latina woman in her early 20s, athletic build, long dark hair pulled back in a high ponytail, warm tan skin, determined focused expression, wearing a fitted coral sports bra and matching leggings. Upper body portrait, bright even gym lighting or outdoor morning light. Neutral light background. High energy, fit, motivated. No text, no logos.',
  },
  {
    id: 'omar',
    name: 'Omar',
    description: 'Late 20s Black man, fitness',
    gender: 'male',
    ageRange: '26-35',
    ethnicity: 'Black',
    bodySize: 'slim',
    style: 'fitness',
    generationPrompt: 'Portrait photo of a Black man in his late 20s, athletic muscular build, short cropped hair, dark skin with a healthy sheen, intense focused expression, wearing a fitted black performance tank top. Upper body portrait, dramatic side gym lighting, strong directional shadow. Neutral dark background. Powerful, disciplined, athletic energy. No text, no logos.',
  },

  // ── Older representation ──────────────────────────────────────────
  {
    id: 'catherine',
    name: 'Catherine',
    description: '40s white woman, professional lifestyle',
    gender: 'female',
    ageRange: '36-50',
    ethnicity: 'White',
    bodySize: 'slim',
    style: 'professional',
    generationPrompt: 'Portrait photo of a white woman in her early 40s, silver-streaked brown hair in an elegant bob, fair skin with natural fine lines, confident poised smile, wearing a structured camel blazer. Upper body portrait, warm professional soft lighting. Clean cream background. Polished, experienced, trustworthy energy. No text, no logos.',
  },
  {
    id: 'david',
    name: 'David',
    description: '40s South Asian man, professional',
    gender: 'male',
    ageRange: '36-50',
    ethnicity: 'South Asian',
    bodySize: 'average',
    style: 'professional',
    generationPrompt: 'Portrait photo of a South Asian man in his mid 40s, salt-and-pepper hair neatly combed, medium-warm brown skin, warm authoritative smile, wearing a deep charcoal suit with an open collar. Upper body portrait, warm even executive lighting. Neutral dark background. Authoritative, experienced, approachable leadership energy. No text, no logos.',
  },

  // ── Plus-size male ────────────────────────────────────────────────
  {
    id: 'chris',
    name: 'Chris',
    description: '30s plus-size white man, casual lifestyle',
    gender: 'male',
    ageRange: '26-35',
    ethnicity: 'White',
    bodySize: 'plus',
    style: 'casual',
    generationPrompt: 'Portrait photo of a white man in his early 30s, plus-size build, medium brown hair with a relaxed beard, fair skin, big warm genuine smile, wearing a soft flannel shirt in blue and grey plaid. Upper body portrait, warm indoor afternoon light. Cosy blurred domestic background. Friendly, welcoming, approachable energy. No text, no logos.',
  },
  {
    id: 'nina',
    name: 'Nina',
    description: 'Early 20s East Asian woman, professional lifestyle',
    gender: 'female',
    ageRange: '18-25',
    ethnicity: 'East Asian',
    bodySize: 'slim',
    style: 'professional',
    generationPrompt: 'Portrait photo of a young East Asian woman in her early 20s, straight black hair in a sleek shoulder-length cut, light warm skin tone, calm professional smile, wearing a crisp white button-down blouse with a simple necklace. Upper body portrait, clean bright studio lighting. Pure white background. Fresh, composed, professional energy. No text, no logos.',
  },
];
