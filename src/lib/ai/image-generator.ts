import crypto from 'crypto';
import type { BrandIdentity, BrandVoice, ImageStyle, ImageSubtype, ImageAspectRatio, ImageProvider, PromptMode, SocialChannel } from '@/lib/schemas';
import { fetchWithRetry } from '@/lib/fetch-retry';
import { assertSafeOutboundUrl, readResponseBufferWithLimit } from '@/lib/network-security';

export type ImageGenRequest = {
  prompt: string;
  promptMode?: PromptMode;
  customPrompt?: string;
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
  /** Visual category — overrides random scene selection with a specific visual type */
  subtype?: ImageSubtype;
  style: ImageStyle;
  aspectRatio: ImageAspectRatio;
  provider: ImageProvider;
  /** URLs of app screenshots to render inside phone mockups */
  screenUrls?: string[];
  /** URL of the product logo to include in the image */
  logoUrl?: string;
  /** Grounded market research context — informs visual scene and aesthetic direction */
  researchContext?: ImageResearchContext;
};

export type ImageResearchContext = {
  /** Visual styles and content formats currently performing well in this niche */
  trendingVisualAngles: string[];
  /** The emotional tone the audience is responding to right now */
  audienceMood?: string;
  /** Competitor visual gaps — what angles to avoid (oversaturated) */
  competitorVisualGaps?: string[];
};

export type ImageGenResult = {
  imageUrl: string;
  provider: ImageProvider;
  revisedPrompt?: string;
};


/** Pick a random element from an array. */
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

/**
 * Subtype scene directions — when a user picks a subtype, these override
 * the random category scene selection with a specific visual direction.
 */
const SUBTYPE_SCENES: Record<ImageSubtype, string> = {
  'product-hero': 'The product is the SOLE HERO of the image — center frame, dramatic lighting, every detail razor-sharp. Think Apple product shot or luxury watch ad. The background complements but the product commands 100% of attention. Shallow depth of field, premium materials visible.',
  'lifestyle': 'Show the product naturally integrated into a real, aspirational moment of someone\'s life — NOT posed, NOT looking at camera. A candid scene where the product belongs: morning routines, evening unwinds, creative sessions, social gatherings. The FEELING of the moment matters more than the product visibility.',
  'flat-lay': 'Overhead bird\'s-eye flat lay arrangement. The product surrounded by curated complementary objects — tools, ingredients, accessories, textures — that tell a story about WHO uses this product and WHY. Every object intentional, spacing deliberate, surface texture rich (marble, linen, wood, concrete).',
  'texture-detail': 'EXTREME MACRO close-up — fill the entire frame with the product\'s surface texture, material quality, or a single fascinating detail. Fabric weave, liquid viscosity, grain pattern, metallic finish, ingredient crystals. Make the viewer want to reach out and touch it. Almost abstract in its closeness.',
  'before-after': 'A single frame that shows TRANSFORMATION — split composition, contrasting halves, or a transitional moment. One side shows the problem (messy, stressful, dull), the other shows the result (clean, calm, vibrant). The product is the bridge between the two states. Use contrasting lighting and color to emphasize the shift.',
  'hands-in-action': 'Close-up of HANDS interacting with the product or its outcome — applying, opening, creating, building, pouring, styling. Hands tell stories of craft, care, and intention. Show the intimate, tactile moment of use. Natural skin texture, warm directional light, shallow depth of field on the hands.',
  'environment': 'The product\'s WORLD — a wide establishing shot showing the environment, space, or landscape where this product lives and matters. The product can be small in frame or implied. Emphasize atmosphere, scale, and context. Architectural spaces, natural landscapes, curated interiors, urban scenes.',
  'still-life': 'Classical still life composition inspired by fine art — dramatic chiaroscuro lighting, rich dark background, the product arranged with meaningful objects like a Dutch Golden Age painting. Moody, luxurious, gallery-worthy. Deep shadows, selective highlighting, visible texture in every surface.',
  'silhouette': 'The product or a person using it shown in SILHOUETTE — backlit dramatically against a vivid sky, neon glow, window light, or color gradient. Shape and form tell the story. Minimal detail, maximum mood and drama. The outline IS the message.',
  'behind-the-scenes': 'The MAKING of the product — raw materials, workshop, kitchen, studio, farm, factory. Show the craft, process, and human effort behind what the customer sees. Messy, authentic, real. Sawdust, flour clouds, paint splatters, measuring tools. The honest beauty of creation.',
  'ingredients-raw': 'The RAW COMPONENTS that make this product — ingredients, materials, elements — arranged beautifully in their natural state. Fresh herbs, raw minerals, fabric bolts, circuit components, coffee beans. Each ingredient is a character in the product\'s origin story. Rich colors, natural textures, editorial arrangement.',
  'mood-abstract': 'An ABSTRACT or CONCEPTUAL image that captures the FEELING of the product without showing it directly. Color fields, flowing shapes, light patterns, water ripples, smoke, paint, or natural phenomena that evoke the emotion the product creates. Gallery-quality art that makes the viewer feel the brand.',
};

/**
 * Creative visual concepts that can be applied to ANY product type.
 * Each concept is a storytelling / compositional idea — not a subject.
 */
const CREATIVE_CONCEPTS = [
  'CONCEPT: Capture the exact MOMENT this product changes someone\'s day — the split-second of delight, relief, or discovery. Freeze that emotional turning point.',
  'CONCEPT: Show the product\'s world through an UNEXPECTED SCALE — macro close-up revealing hidden textures and details invisible to the naked eye, making the familiar feel extraordinary.',
  'CONCEPT: Create a VISUAL METAPHOR — represent what this product does through a symbolic scene. Example: a productivity tool → a perfectly orchestrated domino chain in motion.',
  'CONCEPT: Tell a BEFORE/DURING story in a single frame — use split lighting, contrasting halves, or a transitional moment that shows transformation mid-happening.',
  'CONCEPT: Show the ABSENCE — what life looks like WITHOUT this product. The empty space, the missing piece, the unsolved tension. Make the viewer feel the gap.',
  'CONCEPT: Capture the product in an UNEXPECTED ENVIRONMENT that still makes perfect sense — a surprising context that reveals something new about its value.',
  'CONCEPT: Focus on HANDS IN ACTION — the intimate, tactile moment of someone interacting with or benefiting from this product. Hands tell stories of craft, care, and intention.',
  'CONCEPT: Create a STILL LIFE composition inspired by Dutch Golden Age painting — arrange the product and related objects with dramatic chiaroscuro lighting and rich, moody atmosphere.',
  'CONCEPT: Show the RIPPLE EFFECT — one person using this product, and the cascading positive impact on the people and world around them. Concentric circles of benefit.',
  'CONCEPT: Capture MOTION BLUR and ENERGY — the product or its effect in dynamic movement. Streak lights, flowing fabrics, splashing liquids, wind-swept scenes.',
  'CONCEPT: Create a TOP-DOWN KNOLLING arrangement — the product and everything it connects to, arranged in a satisfying, organized grid pattern on a textured surface.',
  'CONCEPT: Show a QUIET INTIMATE MOMENT — a single person in a private, unguarded moment benefiting from this product. Voyeuristic, authentic, and emotionally honest.',
  'CONCEPT: Create DRAMATIC CONTRAST — pair the product with its opposite. Chaos vs. order, old vs. new, complex vs. simple. Let the juxtaposition tell the story.',
  'CONCEPT: Show the product through a WINDOW, DOORWAY, or FRAME-WITHIN-A-FRAME — create depth and mystery, as if the viewer is discovering something private and beautiful.',
  'CONCEPT: Capture the AFTERMATH — the satisfying result after the product has done its work. The clean surface, the finished project, the peaceful moment after the storm.',
  'CONCEPT: Create an AERIAL or BIRD\'S-EYE perspective — see the product\'s impact from above, showing patterns, scale, and context invisible from ground level.',
  'CONCEPT: Show NATURE RECLAIMING or INTERACTING with the product — vines growing around it, water flowing over it, light filtering through it. Organic meets designed.',
  'CONCEPT: Capture GOLDEN HOUR MAGIC — the product bathed in that perfect 15-minute window of warm, directional sunlight that makes everything look cinematic and alive.',
  'CONCEPT: Create a DOUBLE EXPOSURE effect — blend the product with the world it belongs to. The product\'s silhouette filled with the landscape, texture, or scene it enables.',
  'CONCEPT: Show the product as part of a RITUAL or ROUTINE — the morning coffee ceremony, the evening unwind, the weekly treat. Repetition that feels sacred, not mundane.',
];

/**
 * Category-specific visual subjects — multiple options per category for variety.
 * Each array has diverse scene ideas so no two images default to the same composition.
 */
type CategoryScenes = { keywords: string[]; category: string; scenes: string[] };

const CATEGORY_SCENE_POOLS: CategoryScenes[] = [
  {
    keywords: ['fashion', 'style', 'outfit', 'clothing', 'apparel', 'wear', 'app', 'mobile', 'software', 'platform'],
    category: 'FASHION-TECH / STYLE DISCOVERY',
    scenes: [
      'Editorial street-style moment outside a fashion week venue or nightlife entrance — confidence, motion, flash reflections, and strong personal style. The image is about taste, identity, and social energy.',
      'Mirror-check ritual before stepping out — a private, cinematic second of self-expression and anticipation rather than wardrobe administration. Moody light, reflective surfaces, tension in the pose.',
      'Accessory-driven close-up — rings, nails, fabric texture, sneaker edge, bag hardware, layered styling details that communicate taste without explaining it.',
      'A trend moodboard made physical — torn editorial pages, swatches, jewelry, receipts, nightlife ephemera, and styling notes arranged like a cultural artifact instead of a product dump.',
      'Candid urban transition shot — someone moving from subway stairs to streetlight glow, outfit in motion, the city acting like a runway.',
      'Backstage or atelier energy — steam, garment bags, pins, makeup traces, shoes on concrete, the charged atmosphere before a look goes public.',
      'Cultural nightlife scene — velvet ropes, taxi reflections, bathroom mirror glow, chrome fixtures, and the emotional charge of being seen.',
    ],
  },
  {
    keywords: ['fashion', 'clothing', 'apparel', 'wear', 'dress', 'outfit', 'shoe', 'sneaker', 'accessories', 'jewelry', 'bag', 'handbag'],
    category: 'FASHION/APPAREL',
    scenes: [
      'Street-level candid: someone mid-stride on rain-slicked cobblestones, the garment catching wind and light. Urban texture, reflected neon, cinematic motion.',
      'Intimate dressing room moment: hands adjusting fabric in a mirror, warm tungsten light, visible thread texture, the private ritual of getting dressed.',
      'Backstage fashion-craft moment: garment steam rising, tailoring marks, pins, threads, and half-finished styling decisions. The energy of a look coming together.',
      'Close-up of fabric texture against skin — the weave, the drape, the way light plays across the material. Macro lens, shallow depth of field, tactile and sensory.',
      'Silhouette at golden hour on a rooftop or bridge — the garment\'s shape is the hero, backlit and dramatic, city or nature stretching behind.',
      'Hands of a tailor or craftsperson working with the material — pins, thread, scissors — emphasizing the craft and intention behind the product.',
      'Street-cast portrait in a liminal urban space — parking structure, stairwell, alley mural, or train platform — where styling and attitude carry the frame.',
    ],
  },
  {
    keywords: ['beauty', 'skincare', 'cosmetic', 'makeup', 'haircare', 'fragrance', 'perfume', 'serum', 'moisturizer'],
    category: 'BEAUTY/SKINCARE',
    scenes: [
      'Macro shot of product texture — the swirl of a cream, the golden viscosity of an oil, the crystalline surface of a pressed powder. Abstract, almost geological.',
      'Product floating in or emerging from water — submerged botanicals, rippling reflections, liquid transparency revealing the formula inside.',
      'Morning bathroom counter still life — steam from a shower visible, product among personal objects, toothbrush, towel, plant — intimate and real.',
      'Ingredient origin story: the raw botanicals, minerals, or fruits that become this product — arranged on slate, marble, or wood with dramatic side lighting.',
      'Close-up of skin with water droplets, product residue catching light — dewy, luminous, alive. No face needed — just texture, light, and moisture.',
      'Product arranged with its seasonal inspiration — autumn leaves, spring blossoms, summer citrus, winter frost — connecting formula to nature.',
      'Hands applying product in a slow, ritualistic gesture — cream between fingertips, oil dropping onto a palm — focus on the sensory moment.',
    ],
  },
  {
    keywords: ['food', 'beverage', 'drink', 'restaurant', 'recipe', 'snack', 'coffee', 'tea', 'meal', 'kitchen', 'cooking', 'bakery', 'grocery'],
    category: 'FOOD/BEVERAGE',
    scenes: [
      'Mid-pour or mid-drizzle freeze-frame — honey, chocolate, sauce, or liquid caught in motion, glistening and viscous. Dark moody background, single spotlight.',
      'Hands tearing, breaking, or slicing the food — bread pulled apart revealing steamy interior, fruit being cut, cheese being sliced. Tactile and craving-inducing.',
      'Cross-section or cut-away revealing layers, textures, and colors inside — the internal architecture of food as art. Clean background, surgical precision.',
      'The product in a surprising outdoor setting — a picnic on a cliff edge, breakfast on a boat, coffee on a foggy morning porch. Context creates story.',
      'Overhead arrangement of raw ingredients arranged by color gradient — the palette of flavors that become this product. Painterly, organized, appetizing.',
      'Steam, smoke, or condensation as the hero — the warmth rising from a fresh dish, fog on a cold glass, breath of heat from an oven door opening.',
      'A single bite taken — the first spoonful, the bitten corner, the half-empty glass. The evidence of enjoyment, the promise of more.',
    ],
  },
  {
    keywords: ['fitness', 'gym', 'workout', 'health', 'wellness', 'supplement', 'protein', 'yoga', 'sport', 'athletic'],
    category: 'FITNESS/WELLNESS',
    scenes: [
      'Extreme close-up of effort — chalk-dusted hands gripping a bar, sweat droplets on skin, muscle fiber tension. Raw, visceral, powerful.',
      'Silhouette in motion against a dramatic sky — running, stretching, leaping. The human form as sculpture, nature as the gym.',
      'The calm AFTER the storm — someone in peaceful rest after a workout, mat rolled up, water bottle empty, expression of earned serenity.',
      'Product arranged with the tools of the discipline — yoga blocks, resistance bands, running shoes, fresh fruit — a still life of commitment.',
      'Underwater or through-glass perspective of movement — distorted, dreamlike, showing the fluid grace of the body in motion.',
      'Early morning ritual: 5 AM alarm clock, dark sky through window, product ready on the counter — the discipline and dedication before anyone else is awake.',
      'Texture of materials: grip patterns, mesh ventilation, sole treads, zipper pulls — the engineered details that separate serious gear from the rest.',
    ],
  },
  {
    keywords: ['home', 'interior', 'furniture', 'decor', 'candle', 'plant', 'living', 'bedroom', 'kitchen', 'garden', 'outdoor'],
    category: 'HOME/INTERIOR',
    scenes: [
      'The product catching a shaft of morning light through linen curtains — dust motes floating, long shadows, the quiet beauty of domestic dawn.',
      'An overhead floor plan perspective — the product in situ, showing how it anchors or transforms the space around it. Architectural, intentional.',
      'Close-up of material and craft — wood grain, textile weave, ceramic glaze, metal patina. The honest beauty of materials, touched by human hands.',
      'The product framed by an open window or doorway looking out to nature — inside meets outside, domestic comfort meets wild beauty.',
      'A lived-in vignette: the product alongside a dog-eared book, a half-drunk cup of tea, reading glasses — evidence of a life being lived well.',
      'Night scene: the product lit by candlelight or a single warm lamp — intimate, cozy, the shelter of home against a dark window.',
      'Seasonal transformation: the same corner styled for a specific season — autumn warmth, summer breeze, winter hygge, spring renewal.',
    ],
  },
  {
    keywords: ['travel', 'hotel', 'hospitality', 'tourism', 'vacation', 'resort', 'adventure', 'destination'],
    category: 'TRAVEL/HOSPITALITY',
    scenes: [
      'Point-of-view perspective: feet at the edge of something extraordinary — a cliff, a pool, a new city. The viewer IS the traveler.',
      'A window seat moment: the product or experience framed through a train, plane, or hotel window — the world scrolling past, anticipation building.',
      'Local detail close-up: artisan tiles, hand-painted ceramics, street food texture, woven textiles — the small details that define a place.',
      'Blue hour or twilight scene: the destination in that magical 20 minutes between day and night — deep blues, warm amber lights, atmospheric and dreamy.',
      'An open suitcase or travel bag with carefully arranged essentials — the curation of a journey, each object a promise of adventure.',
      'Reflection in water, glass, or a mirror — the destination doubled, creating symmetry and depth. Serene, contemplative, visually striking.',
      'A solitary figure dwarfed by landscape — vast desert, dense jungle, endless ocean — scale that makes you feel the enormity of exploration.',
    ],
  },
  {
    keywords: ['education', 'course', 'learning', 'teaching', 'tutorial', 'school', 'training', 'academy'],
    category: 'EDUCATION',
    scenes: [
      'Hands actively creating — writing, sketching, building, coding — the evidence of knowledge becoming action. Close-up, warm light, focused energy.',
      'A before/after desk: one side cluttered and chaotic, the other organized and productive — the visual transformation learning brings.',
      'An "aha moment" captured: someone looking up from their work with realization, surrounded by notes, books, materials — the breakthrough instant.',
      'A curated workspace aerial view: notebook open to handwritten notes, colored pens, laptop showing progress, coffee, plant — the learner\'s ecosystem.',
      'Stacked or arranged books, notebooks, and tools creating an abstract tower or pattern — knowledge as architecture, learning as building.',
      'A mentor\'s hands guiding a student\'s — close-up of shared focus on a task, passing knowledge through gesture and proximity.',
      'Light breaking through: someone stepping from a dark library corridor into sunlit courtyard — metaphor for enlightenment, literally illuminated.',
    ],
  },
  {
    keywords: ['saas', 'software', 'mobile', 'web', 'api', 'platform', 'dashboard', 'analytics'],
    category: 'SOFTWARE/TECH',
    scenes: [
      'The human outcome: someone leaning back in their chair with a satisfied smile, the hard work DONE — a clear desk, a closed laptop, the result of efficiency.',
      'A creative workspace exploding with ideas — sticky notes, sketches, whiteboard drawings, prototypes — the messy, beautiful process this tool enables.',
      'Hands building something physical — a model, a prototype, a craft — representing the tangible things made possible by digital tools.',
      'Two people in genuine collaboration — pointing at something together, laughing, problem-solving — the connection and teamwork the platform enables.',
      'A cityscape or landscape transformed — before: gray and dormant, after: vibrant and alive — showing the macro impact of the tool at scale.',
      'Objects in perfect geometric arrangement — representing data, order, and clarity. Satisfying patterns that evoke the feeling of organized information.',
      'A single key, door, or bridge — a powerful metaphor for access, connection, or unlocking potential. Minimal, symbolic, thought-provoking.',
    ],
  },
];

type CategoryLens = {
  keywords: string[];
  category: string;
  support: string[];
  avoid?: string[];
};

const CATEGORY_LENSES: CategoryLens[] = [
  {
    keywords: ['fashion', 'style', 'outfit', 'clothing', 'apparel', 'wear', 'app', 'mobile', 'software', 'platform'],
    category: 'FASHION-TECH / STYLE DISCOVERY',
    support: [
      'Prioritize taste, self-expression, confidence, cultural relevance, and social energy over literal organization or wardrobe admin.',
      'Think editorial street style, nightlife anticipation, styling rituals, detail obsession, and the emotional charge of getting a look right.',
      'Make the frame feel like a fashion campaign, street-style photograph, or trend moodboard fragment rather than a utility app explainer.',
    ],
    avoid: [
      'closet clean-up scenes',
      'wardrobe organization visuals',
      'folded or scattered clothes on a bed',
      'hangers, storage bins, or laundry imagery as the main subject',
      'generic apparel flat-lays unless the brief explicitly calls for one',
    ],
  },
  {
    keywords: ['fashion', 'clothing', 'apparel', 'wear', 'dress', 'outfit', 'shoe', 'sneaker', 'accessories', 'jewelry', 'bag', 'handbag'],
    category: 'FASHION / APPAREL',
    support: [
      'Prioritize attitude, silhouette, texture, movement, and styling details over domestic storage scenes.',
      'Fashion images should feel editorial, tactile, and culturally aware rather than catalog-like or overly tidy.',
    ],
    avoid: [
      'generic clothing piles',
      'bedroom organization tropes',
      'plain ecommerce packshots unless requested',
    ],
  },
  {
    keywords: ['beauty', 'skincare', 'cosmetic', 'makeup', 'haircare', 'fragrance', 'perfume', 'serum', 'moisturizer'],
    category: 'BEAUTY / SKINCARE',
    support: [
      'Lean into ritual, sensorial texture, glow, moisture, reflection, and ingredient intimacy.',
      'Beauty imagery should feel tactile and aspirational, not like a generic vanity flat-lay.',
    ],
  },
  {
    keywords: ['food', 'beverage', 'drink', 'restaurant', 'recipe', 'snack', 'coffee', 'tea', 'meal', 'kitchen', 'cooking', 'bakery', 'grocery'],
    category: 'FOOD / BEVERAGE',
    support: [
      'Prioritize appetite, texture, heat, atmosphere, and the instant before or after pleasure.',
      'Food imagery should trigger craving or memory, not read like a menu placeholder.',
    ],
  },
  {
    keywords: ['fitness', 'gym', 'workout', 'health', 'wellness', 'supplement', 'protein', 'yoga', 'sport', 'athletic'],
    category: 'FITNESS / WELLNESS',
    support: [
      'Focus on effort, release, discipline, body intelligence, and earned calm instead of generic gym promo energy.',
      'Wellness imagery should feel embodied and real, not like a stock ad with forced smiles.',
    ],
  },
  {
    keywords: ['home', 'interior', 'furniture', 'decor', 'candle', 'plant', 'living', 'bedroom', 'kitchen', 'garden', 'outdoor'],
    category: 'HOME / INTERIOR',
    support: [
      'Prioritize atmosphere, materiality, and the emotional shelter of the space.',
      'Interior imagery should feel lived-in and art-directed, not like a sterile catalog shot.',
    ],
  },
  {
    keywords: ['travel', 'hotel', 'hospitality', 'tourism', 'vacation', 'resort', 'adventure', 'destination'],
    category: 'TRAVEL / HOSPITALITY',
    support: [
      'Prioritize anticipation, scale, local texture, and the feeling of crossing into another world.',
      'Travel imagery should feel transportive, not like brochure filler.',
    ],
  },
  {
    keywords: ['education', 'course', 'learning', 'teaching', 'tutorial', 'school', 'training', 'academy'],
    category: 'EDUCATION',
    support: [
      'Focus on curiosity, breakthrough, craft, and the physical traces of learning in motion.',
      'Avoid generic classroom or laptop stock imagery unless the brief explicitly demands it.',
    ],
  },
  {
    keywords: ['saas', 'software', 'mobile', 'web', 'api', 'platform', 'dashboard', 'analytics'],
    category: 'SOFTWARE / TECH',
    support: [
      'Anchor the image in human outcome, metaphor, atmosphere, or collaboration rather than generic screens or holographic interfaces.',
      'Software imagery should make the benefit feel tangible in the real world.',
    ],
    avoid: [
      'floating UI cards',
      'circuit boards',
      'blue holograms',
      'generic dashboards unless screenshots were explicitly provided',
    ],
  },
];

/**
 * Randomized creative elements to inject unique variety into every image.
 */
const LIGHTING_OPTIONS = [
  'Dramatic Rembrandt lighting with deep shadows and a single warm key light',
  'Soft overcast diffused daylight — even, gentle, no harsh shadows',
  'Neon-tinged urban night with colored reflections on wet surfaces',
  'Golden hour backlight with lens flare and warm atmospheric haze',
  'Harsh midday sun creating graphic black shadows and bleached highlights',
  'Candlelit warmth — flickering amber, intimate, chiaroscuro',
  'Blue hour twilight — deep cerulean sky, warm artificial lights emerging',
  'Dappled forest light filtering through leaves, creating pattern and movement',
  'Studio rim light on dark background — the subject glows from the edges',
  'Overexposed dreamy glow — airy, ethereal, almost heavenly brightness',
];

const COMPOSITION_OPTIONS = [
  'Extreme close-up macro — fill the frame with texture and detail invisible to the naked eye',
  'Wide establishing shot — the product or subject small within a grand environment, emphasizing context',
  'Dutch angle tilt — 15-degree rotation creating dynamic tension and visual energy',
  'Symmetrical center-frame — perfectly balanced, hypnotic, Wes Anderson-inspired precision',
  'Rule of thirds with strong negative space — the subject offset, breathing room that creates elegance',
  'Overhead bird\'s-eye flat lay — looking straight down, organized or artfully scattered',
  'Low angle looking up — the subject appears powerful, monumental, larger than life',
  'Through-frame composition — shot through a doorway, window, foliage, or arch creating depth layers',
  'Diagonal leading lines drawing the eye — paths, shadows, architecture guiding toward the focal point',
  'Extreme shallow depth of field — razor-thin focus plane, everything else melts into creamy bokeh',
];

const COLOR_PALETTE_OPTIONS = [
  'Warm earth tones: terracotta, sage, ochre, cream — grounded and organic',
  'Cool oceanic: deep navy, seafoam, pearl white, silver — serene and expansive',
  'Vibrant complementary pop: one electric accent color against muted neutrals — attention-grabbing',
  'Muted pastels: dusty rose, lavender, mint, butter — soft, approachable, modern',
  'High contrast monochrome with a single color accent — dramatic and editorial',
  'Jewel tones: emerald, sapphire, ruby, amethyst — rich, luxurious, deep',
  'Sun-bleached naturals: sand, driftwood, stone, pale sky — effortless coastal calm',
  'Film-inspired: slightly desaturated with lifted blacks and teal shadows — nostalgic and cinematic',
  'Botanical greens: moss, fern, olive, forest — alive, fresh, connected to nature',
  'Warm metallics: copper, gold, brass against dark backgrounds — premium and sophisticated',
];

const TEXTURE_OPTIONS = [
  'Raw concrete, weathered wood, and linen — industrial meets organic',
  'Glossy reflective surfaces, glass, and water — clean, modern, transparent',
  'Rough stone, dried earth, and clay — primal, geological, ancient',
  'Soft fabrics, knits, and velvet — touchable, cozy, sensory',
  'Wet surfaces with water droplets and condensation — fresh, alive, dynamic',
  'Paper, cardboard, and craft materials — handmade, honest, artisanal',
  'Marble, terrazzo, and polished mineral — refined luxury, geological art',
  'Rust, patina, and aged metal — character, history, authentic wear',
];

function hasDetailedScenePrompt(prompt: string): boolean {
  const normalized = prompt.trim();
  if (normalized.length >= 180) return true;
  const sentenceCount = normalized
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
  return sentenceCount >= 2;
}

function isFashionTechContext(context: string): boolean {
  const hasFashionSignal = /fashion|style|outfit|clothing|apparel|wear|sneaker|accessor|jewelry|bag/.test(context);
  const hasTechSignal = /app|mobile|software|platform|digital|ai|tool|startup|web/.test(context);
  return hasFashionSignal && hasTechSignal;
}

function getCategoryLens(context: string): CategoryLens | undefined {
  if (isFashionTechContext(context)) return CATEGORY_LENSES[0];
  return CATEGORY_LENSES.slice(1).find((lens) => lens.keywords.some((k) => context.includes(k)));
}

/**
 * Return product-type-aware subject direction for image generation.
 * If a subtype is provided, uses the subtype's specific scene direction.
 * Otherwise, randomly selects from diverse scene pools so no two images look alike.
 */
function getProductSubjectDirection(
  categories: string[],
  context: string,
  prompt: string,
  subtype?: ImageSubtype,
): string {
  const is = (keywords: string[]) => keywords.some((k) => context.includes(k));
  const detailedScenePrompt = hasDetailedScenePrompt(prompt);
  const matchedLens = getCategoryLens(context);
  const matchedScenePool = isFashionTechContext(context)
    ? CATEGORY_SCENE_POOLS[0]
    : CATEGORY_SCENE_POOLS.slice(1).find((pool) => is(pool.keywords));

  const lensLines = matchedLens
    ? [
        `CATEGORY LENS: ${matchedLens.category}`,
        ...matchedLens.support.map((line) => `- ${line}`),
      ]
    : [];

  const avoidLines = matchedLens?.avoid && matchedLens.avoid.length > 0
    ? [
        'AVOID THESE CLICHES UNLESS THE PRIMARY SCENE BRIEF EXPLICITLY REQUESTS THEM:',
        ...matchedLens.avoid.map((line) => `- ${line}`),
      ]
    : [];

  // If subtype is provided, use it as the primary scene direction
  if (subtype && SUBTYPE_SCENES[subtype]) {
    const categoryLabel = matchedScenePool ? `This is a ${matchedScenePool.category} product.` : '';

    const lighting = pick(LIGHTING_OPTIONS);
    const composition = pick(COMPOSITION_OPTIONS);
    const palette = pick(COLOR_PALETTE_OPTIONS);
    const texture = pick(TEXTURE_OPTIONS);

    return [
      categoryLabel,
      lensLines.length > 0 ? lensLines.join('\n') : '',
      `VISUAL TYPE: ${subtype.toUpperCase()}`,
      SUBTYPE_SCENES[subtype],
      detailedScenePrompt
        ? 'PRIMARY SCENE RULE: The primary scene brief below is the source of truth. Use this subtype only as the visual treatment. Do NOT replace the scene, metaphor, or emotional moment described in the brief.'
        : '',
      '',
      `LIGHTING: ${lighting}`,
      `COMPOSITION: ${composition}`,
      `COLOR: ${palette}`,
      `TEXTURE/MATERIALS: ${texture}`,
      '',
      avoidLines.length > 0 ? avoidLines.join('\n') : '',
      avoidLines.length > 0 ? '' : '',
      'CRITICAL: This image must look NOTHING like a stock photo. Specific, surprising, and emotionally resonant.',
      'Do NOT show: generic smiling people looking at camera, product-on-white backgrounds, abstract tech patterns, circuit boards, or holographic UIs.',
    ].join('\n');
  }

  // For detailed prompts, keep category guidance supportive only so we don't overwrite the scene brief.
  const sceneLine = detailedScenePrompt
    ? [
        matchedScenePool ? `This is a ${matchedScenePool.category} product.` : '',
        'PRIMARY SCENE RULE: The primary scene brief below is the source of truth. Do NOT substitute a more generic category scene, prop story, or setting.',
      ].filter(Boolean).join('\n')
    : matchedScenePool
      ? `This is a ${matchedScenePool.category} product.\nSCENE SUPPORT: ${pick(matchedScenePool.scenes)}`
      : `SCENE SUPPORT: ${pick([
          'Show this product in an unexpected real-world context that reveals its true value — the setting should surprise but make perfect sense.',
          'Focus on the human moment this product creates — hands, expressions, body language that tell the story without words.',
          'Create a striking still life that positions this product as the hero — dramatic lighting, curated objects, gallery-worthy composition.',
          'Show the world AFTER this product has done its work — the satisfying result, the calm after the storm, the problem beautifully solved.',
          'Capture an intimate, authentic moment of someone discovering or enjoying this product — candid, unposed, emotionally honest.',
          'Use a visual metaphor: represent what this product does through an unexpected symbolic scene that makes the viewer think.',
          'Show the product in its natural habitat but from a perspective nobody expects — aerial, macro, underwater, through glass, reflected.',
        ])}`;

  // Layer on a randomized creative concept for additional uniqueness
  const concept = pick(CREATIVE_CONCEPTS);

  // Randomized technical direction
  const lighting = pick(LIGHTING_OPTIONS);
  const composition = pick(COMPOSITION_OPTIONS);
  const palette = pick(COLOR_PALETTE_OPTIONS);
  const texture = pick(TEXTURE_OPTIONS);

  return [
    sceneLine,
    '',
    lensLines.length > 0 ? lensLines.join('\n') : '',
    lensLines.length > 0 ? '' : '',
    concept,
    '',
    `LIGHTING: ${lighting}`,
    `COMPOSITION: ${composition}`,
    `COLOR: ${palette}`,
    `TEXTURE/MATERIALS: ${texture}`,
    '',
    avoidLines.length > 0 ? avoidLines.join('\n') : '',
    avoidLines.length > 0 ? '' : '',
    'CRITICAL: This image must look NOTHING like a stock photo. It should feel like a frame from a film, a page from a high-end magazine, or a moment captured by a documentary photographer. Specific, surprising, and emotionally resonant.',
    'Do NOT show: generic smiling people looking at camera, product-on-white backgrounds, abstract tech patterns, circuit boards, or holographic UIs.',
  ].join('\n');
}

/**
 * Build the image prompt with CREATIVE DIRECTION FIRST.
 *
 * The randomized creative elements lead the prompt so the model
 * prioritizes them over static product/platform context.
 */
function buildGuidedImagePrompt(req: ImageGenRequest): string {
  const sections: string[] = [];

  // ── Gather product context ──
  const categories = req.productCategories || [];
  const descLower = (req.productDescription || '').toLowerCase();
  const nameLower = (req.productName || '').toLowerCase();
  const context = `${categories.join(' ')} ${descLower} ${nameLower}`;

  // Build a concise product identity line that gets embedded in the creative direction
  const productIdentity = req.productName
    ? `THE PRODUCT: "${req.productName}"${req.productDescription ? ` — ${req.productDescription.slice(0, 150)}` : ''}${req.productCategories?.length ? ` (${req.productCategories.join(', ')})` : ''}`
    : '';

  // Keep enough of the scene brief for detailed prompts while still bounding token growth.
  const postExcerpt = req.prompt.length > 900 ? req.prompt.slice(0, 900) + '...' : req.prompt;

  // ── 1. CREATIVE DIRECTION — product identity + creative approach together ──
  const subjectDirection = getProductSubjectDirection(categories, context, req.prompt, req.subtype);

  const researchLines: string[] = [];
  if (req.researchContext) {
    const rc = req.researchContext;
    if (rc.trendingVisualAngles.length > 0) {
      researchLines.push('TRENDING VISUAL ANGLES (what is resonating in this niche right now — lean into one of these):');
      rc.trendingVisualAngles.slice(0, 3).forEach((a) => researchLines.push(`  • ${a}`));
    }
    if (rc.audienceMood) {
      researchLines.push(`AUDIENCE MOOD: The target audience is currently responding to imagery that feels ${rc.audienceMood}. Match this energy.`);
    }
    if (rc.competitorVisualGaps && rc.competitorVisualGaps.length > 0) {
      researchLines.push('VISUAL GAPS TO EXPLOIT (competitors are NOT doing this — stand out by doing it):');
      rc.competitorVisualGaps.slice(0, 2).forEach((g) => researchLines.push(`  • ${g}`));
    }
  }

  sections.push([
    productIdentity,
    'PRIMARY SCENE BRIEF (SOURCE OF TRUTH — EXECUTE THIS SCENE, NOT A GENERIC CATEGORY DEFAULT):',
    postExcerpt,
    '',
    researchLines.length > 0 ? researchLines.join('\n') : '',
    '',
    'CREATIVE APPROACH (use this to make the image unique, but the product above MUST be the clear subject):',
    subjectDirection,
    '',
    'IMPORTANT: The product must be recognizable and central to the image. The creative approach above is HOW to depict it — not a license to ignore it.',
    'Do NOT replace the primary scene brief with a safer or more generic idea. If the brief implies fashion culture, aspiration, identity, nightlife, craftsmanship, or symbolic emotion, preserve that instead of collapsing to wardrobe organization or product catalog imagery.',
    'A viewer should immediately understand what product world or category this image is about, even when the image is metaphorical or editorial.',
  ].filter(Boolean).join('\n'));

  // ── 2. STYLE — randomized per call to prevent repetition ──
  const styleVariants: Record<ImageStyle, string[]> = {
    photorealistic: [
      'STYLE: Cinematic editorial photograph. Hasselblad X2D, 90mm lens. Single directional light, shallow depth of field, subtle film grain.',
      'STYLE: Documentary photography. Leica M11, 35mm lens. Available light, candid energy, slightly desaturated, decisive moment.',
      'STYLE: Fashion editorial. Medium format film look. Intentional color grading, strong shadows, magazine-cover quality.',
      'STYLE: Fine art photography. Large format feel. Hyper-detailed, contemplative, gallery-print quality. Every pixel intentional.',
      'STYLE: Street photography. Ricoh GR III, 28mm. Gritty, authentic, high contrast, captured mid-life.',
    ],
    illustration: [
      'STYLE: Bold editorial illustration. Limited 4-color palette, strong graphic shapes, risograph grain. New Yorker cover energy.',
      'STYLE: Collage-style mixed media. Paper textures, torn edges, layered elements. Vintage meets contemporary.',
      'STYLE: Watercolor editorial. Soft bleeds, confident linework, breathing negative space. Hand-crafted warmth.',
      'STYLE: Flat vector with depth. Clean shapes, bold palette, subtle shadows for dimension. Airbnb/Slack design quality.',
      'STYLE: Ink and brush. Loose, expressive strokes with intentional imperfection. Japanese calligraphy meets modern design.',
    ],
    minimal: [
      'STYLE: High-end minimalism. One hero element, vast negative space, maximum two colors. Japanese design sensibility.',
      'STYLE: Swiss design minimalism. Grid-based, precise geometry, clean edges. Helvetica-era discipline.',
      'STYLE: Scandinavian minimalism. Warm neutrals, organic shapes, natural materials. Cozy restraint.',
      'STYLE: Brutalist minimalism. Raw concrete textures, stark contrast, monumental simplicity.',
    ],
    abstract: [
      'STYLE: Contemporary abstract art. Organic shapes meet geometry, rich layered textures, bold color fields. Gallery quality.',
      'STYLE: Fluid abstract. Ink in water, marbling effects, organic color mixing. Controlled chaos.',
      'STYLE: Geometric abstraction. Hard edges, overlapping planes, architectural color blocking. Mondrian meets today.',
      'STYLE: Textural abstract. Impasto paint, sand, mixed media surfaces. You can almost feel it through the screen.',
    ],
    branded: [
      'STYLE: Premium lifestyle editorial. Natural light, authentic textures, aspirational but real.',
      'STYLE: Modern brand campaign. Bold, confident, clean. Studio-quality with personality.',
      'STYLE: Indie brand aesthetic. Warm film tones, honest lighting, handmade textures. Authentic over polished.',
      'STYLE: Luxury campaign. Deep shadows, selective lighting, rich materials. Understated power.',
      'STYLE: Gen-Z brand energy. Saturated, slightly chaotic, unapologetic. Screenshot-worthy.',
    ],
  };
  const variants = styleVariants[req.style] || styleVariants.branded;
  sections.push(pick(variants));

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

function buildCustomOverrideImagePrompt(req: ImageGenRequest): string {
  const sections: string[] = [];
  const primaryBrief = req.customPrompt?.trim() || req.prompt.trim();

  sections.push([
    'PRIMARY CREATIVE BRIEF (SOURCE OF TRUTH):',
    primaryBrief,
    '',
    'OVERRIDE RULE: Follow the user brief exactly. Supporting context below may clarify constraints, but it must never replace, soften, or reinterpret the requested scene.',
  ].join('\n'));

  if (req.productName || req.productDescription || req.productCategories?.length) {
    sections.push([
      'SUPPORTING PRODUCT CONTEXT:',
      req.productName ? `Product: ${req.productName}` : '',
      req.productDescription ? `Description: ${req.productDescription.slice(0, 200)}` : '',
      req.productCategories?.length ? `Categories: ${req.productCategories.join(', ')}` : '',
    ].filter(Boolean).join('\n'));
  }

  if (req.screenUrls?.length) {
    sections.push([
      `REFERENCE SCREENSHOTS: ${req.screenUrls.length} image(s) attached.`,
      'If screens or devices appear, use the attached screenshots faithfully. Do not redraw, remix, or invent alternate UI.',
    ].join('\n'));
  }

  if (req.logoUrl) {
    sections.push('REFERENCE LOGO: A logo is attached. Only use it when it naturally fits the requested composition, and keep it subtle.');
  }

  if (req.brandIdentity) {
    const colors = [
      req.brandIdentity.primaryColor,
      req.brandIdentity.secondaryColor,
      req.brandIdentity.accentColor,
    ].filter(Boolean);
    if (colors.length > 0) {
      sections.push(`OPTIONAL BRAND COLOR SUPPORT: ${colors.join(', ')}. Use only if the user brief does not specify a conflicting palette.`);
    }
  }

  if (req.brandVoice?.tone) {
    sections.push(`OPTIONAL BRAND TONE SUPPORT: ${req.brandVoice.tone}. Only apply it if it fits the user brief.`);
  }

  const hardConstraints = [
    'QUALITY: Sharp focus, professional color correction, slight film grain.',
    'NO text, words, or typography. NO watermarks.',
  ];

  if (!req.screenUrls?.length) {
    hardConstraints.push(
      'Do NOT show device screens or UI unless the user brief explicitly requests them.',
      'Do NOT default to generic dashboards, holographic interfaces, or abstract tech graphics.',
    );
  }

  sections.push(hardConstraints.join('\n'));

  return sections.join('\n\n');
}

function buildImagePrompt(req: ImageGenRequest): string {
  if (req.promptMode === 'custom_override') {
    return buildCustomOverrideImagePrompt(req);
  }
  return buildGuidedImagePrompt(req);
}

/**
 * Download an image URL and return its base64 data and mime type.
 */
export async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const safeUrl = await assertSafeOutboundUrl(url);
  const res = await fetchWithRetry(
    safeUrl.toString(),
    { redirect: 'error' },
    { timeoutMs: 15_000 },
  );
  if (!res.ok) throw new Error(`Failed to fetch image: ${url}`);
  const contentType = res.headers.get('content-type') || 'image/png';
  if (!contentType.startsWith('image/') || contentType.includes('svg') || contentType.includes('xml')) {
    throw new Error('VALIDATION_INVALID_FILE_TYPE');
  }
  const buffer = await readResponseBufferWithLimit(res, 10 * 1024 * 1024);
  return { base64: buffer.toString('base64'), mimeType: contentType };
}

/**
 * Generate image using Gemini 3.1 Flash — supports multimodal input (logo + screenshots).
 */
export async function generateWithGemini(
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
export async function uploadToFirebaseStorage(
  base64: string,
  mimeType: string,
  workspaceId: string,
): Promise<string> {
  const { uploadToStorage } = await import('@/lib/storage');

  const fileId = crypto.randomUUID();
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const filePath = `workspaces/${workspaceId}/generated/${fileId}.${ext}`;
  const buffer = Buffer.from(base64, 'base64');

  return uploadToStorage(filePath, buffer, mimeType, {
    workspaceId,
    generatedAt: new Date().toISOString(),
  });
}

/**
 * Generate an image using the specified provider, with fallback.
 * Tries Gemini 3.1 Flash first, falls back to OpenAI DALL-E 3.
 */
export async function generateImage(req: ImageGenRequest): Promise<{ base64: string; mimeType: string; provider: ImageProvider; revisedPrompt?: string }> {
  const prompt = buildImagePrompt(req);

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
