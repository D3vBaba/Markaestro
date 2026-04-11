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
 *   Used as the Gemini image generation prompt for the reference lifestyle shots.
 *   These are candid UGC-style 9:16 scenes — people in real environments, not
 *   studio portraits. The angle variant (appended by the seed script) defines
 *   whether the shot is back view, side profile, or candid seated.
 *   Optimised to serve as character consistency reference images for TikTok slideshows.
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
    generationPrompt: 'Candid lifestyle photo of a young Black woman in her early 20s, natural 4C hair in a loose puff, warm brown skin, wearing a cream crewneck, light wash jeans, and white sneakers. She is in an outdoor urban setting — a city sidewalk or park path with soft natural daylight. Full body visible, real-world environment. Warm natural light, authentic iPhone photo quality, slightly lo-fi. No studio, no posed look, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a Black man in his late 20s, close-cropped hair with a fade, deep brown skin, wearing a dark navy crewneck and dark chinos. He is outdoors on a city street or walking through a park, full body visible. Warm natural afternoon sunlight, realistic shadows. Authentic phone camera quality, slightly desaturated warm tones. No studio, no posed look, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a young East Asian woman in her early 20s, straight black hair with curtain bangs, fair skin with warm undertones, wearing an oversized graphic hoodie, baggy cargo pants, and chunky sneakers. She is in an urban setting — a quiet side street, stairs outside a building, or a neighbourhood cafe exterior. Full body visible. Cool overcast urban daylight. Authentic lo-fi phone photo aesthetic, Gen-Z energy. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of an East Asian man in his early 30s, short neat hair, warm medium skin tone, wearing a fitted grey athletic tee, black joggers, and running shoes. He is outdoors — a park running path, outdoor staircase, or urban plaza. Full body visible. Bright natural morning light, clean shadows. Authentic phone camera quality, athletic and healthy energy. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a South Asian woman in her mid 20s, long dark brown hair loose or in a low bun, medium warm skin tone, wearing a smart burgundy jacket over a white shirt and dark trousers. She is on a city street or outside a cafe, full body visible. Warm natural afternoon light, slightly overcast. Authentic phone photo quality, professional yet real-world. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a South Asian man in his late 20s, slightly wavy dark hair, warm brown skin, wearing a soft earth-tone henley shirt and beige chinos. He is outdoors in a warm afternoon setting — a neighbourhood street, park bench area, or cafe patio. Full body visible. Golden warm sunlight, soft shadows. Authentic phone photo feel, friendly and relaxed energy. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a young Latina woman in her early 20s, long wavy dark hair with honey highlights, olive-warm skin tone, wearing a floral summer top, cutoff denim shorts, and sandals. She is in a warm outdoor setting — a sunny park, outdoor market, or street corner with greenery. Full body visible. Warm vibrant natural light, dappled sun. Authentic phone photo quality, joyful and real. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a Latino man in his late 20s, dark hair with a textured fade, medium-warm tan skin, wearing a clean white oversized tee, baggy dark jeans, and fresh Air Force 1s with a thin gold chain. He is on an urban street or a quiet corner near a mural or storefront. Full body visible. Warm urban natural light, slightly stylized. Authentic phone camera feel, confident and cool energy. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a young white woman in her early 20s, shoulder-length blonde hair with natural waves, fair skin with light freckles, wearing a light blue oversized denim shirt, white tee underneath, and light wash mom jeans. She is outdoors in a relaxed setting — a neighbourhood street, park bench, or cafe exterior. Full body visible. Soft natural window or overcast daylight. Lo-fi phone photo quality, friend-next-door energy. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a white man in his early 30s, medium brown hair neatly styled, fair complexion, wearing a light grey crewneck sweater and dark slim chinos. He is on a city sidewalk or outside a coffee shop, full body visible. Clean soft overcast daylight, even natural illumination. Authentic phone photo quality, calm and approachable energy. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a Black woman in her early 30s, plus-size, natural hair in locs, medium-dark skin, wearing a deep emerald wrap blouse and wide-leg trousers. She is outdoors in a stylish urban setting — a cafe entrance, an open plaza, or a tree-lined street. Full body visible. Warm natural daylight. Authentic phone photo quality, confident and radiant energy. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a white woman in her mid 30s, plus-size, warm strawberry-blonde hair in a loose braid, pink fair skin, wearing a cosy rust-orange knit sweater, wide-leg jeans, and ankle boots. She is in a warm real-world setting — a coffee shop, a park bench, or a neighbourhood street in autumn. Full body visible. Warm morning window light or overcast daylight. Authentic phone photo feel, warm and relatable energy. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a young East Asian nonbinary person in their mid 20s, short asymmetric dyed dark-violet hair, pale skin, wearing a structured black oversized jacket with a white tee underneath and wide-leg black trousers. They are in an urban setting — leaning against a wall with interesting texture, a city alley with soft ambient light, or steps outside a building. Full body visible. Cool desaturated urban daylight. Authentic phone photo quality, bold and artistic energy. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a white nonbinary person in their early 30s, short natural brown hair, medium fair skin with subtle freckles, wearing a soft grey blazer over a sage green crewneck and straight-cut trousers. They are on a city street or outside a modern building, full body visible. Soft diffused natural daylight, warm tones. Authentic phone photo quality, confident and approachable energy. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a young Latina woman in her early 20s, athletic build, long dark hair in a high ponytail, warm tan skin, wearing a fitted coral sports bra, matching leggings, and white running shoes. She is outdoors — a park running path, outdoor gym steps, or a sunny urban plaza at morning. Full body visible. Bright natural morning light, clean crisp shadows. Authentic phone photo quality, high-energy fitness vibe. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a Black man in his late 20s, athletic muscular build, short cropped hair, dark skin, wearing a fitted black performance tank and dark athletic shorts. He is outdoors — a park path, outdoor pull-up bars, or a city plaza at early morning. Full body visible. Dramatic natural side light, strong directional shadows. Authentic phone photo quality, powerful and disciplined athletic energy. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a white woman in her early 40s, silver-streaked brown hair in an elegant bob, fair skin with natural fine lines, wearing a structured camel blazer over a simple white top and tailored trousers. She is on a city street or outside a nice restaurant or office building, full body visible. Warm soft natural daylight. Authentic phone photo quality, polished and experienced energy. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a South Asian man in his mid 40s, salt-and-pepper hair neatly combed, medium-warm brown skin, wearing a deep charcoal suit jacket over an open-collar shirt and dark trousers. He is on a city street or outside a glass-fronted building, full body visible. Warm natural executive daylight. Authentic phone photo quality, authoritative and approachable leadership energy. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a white man in his early 30s, plus-size build, medium brown hair with a relaxed beard, fair skin, wearing a soft blue-grey flannel shirt over a white tee and relaxed jeans. He is in a cosy real-world setting — outside a cafe, on a park bench, or a quiet residential street. Full body visible. Warm indoor-spill or overcast afternoon natural light. Authentic phone photo quality, warm and friendly energy. No studio, no text, no logos.',
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
    generationPrompt: 'Candid lifestyle photo of a young East Asian woman in her early 20s, straight black hair in a sleek shoulder-length cut, light warm skin tone, wearing a crisp white button-down blouse with a simple gold necklace and tailored beige trousers. She is outside a modern building or on a clean city sidewalk, full body visible. Bright even natural daylight. Authentic phone photo quality, fresh and composed professional energy. No studio, no text, no logos.',
  },
];
