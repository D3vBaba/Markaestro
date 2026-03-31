import OpenAI from 'openai';
import { SYSTEM_PROMPT, buildBrandVoiceBlock, getChannelConstraints } from './content-generator';
import type { BrandVoice, PipelineConfig, PipelineStage, ResearchBrief, SocialChannel } from '@/lib/schemas';

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
};

export type PipelinePost = {
  content: string;
  pipelineStage: PipelineStage;
  pipelineSequence: number;
  pipelineTheme: string;
  imagePrompt: string;
};

export type GeneratePipelineInput = {
  productName: string;
  productDescription: string;
  productCategories: string[];
  brandVoice?: BrandVoice;
  researchBrief: ResearchBrief;
  pipelineConfig: PipelineConfig;
};

const STAGE_WEIGHTS: Record<PipelineStage, number> = {
  awareness: 0.25,
  interest: 0.20,
  consideration: 0.15,
  trial: 0.15,
  activation: 0.15,
  retention: 0.10,
};

const STAGE_GOALS: Record<PipelineStage, string> = {
  awareness: `GOAL: Make the audience realize they have a problem worth solving. Do NOT mention the product by name. Focus entirely on pain points, frustrations, and "aha" moments the audience experiences daily. Make them feel seen and understood. Content should be relatable and shareable.
IMAGE DIRECTION: Show the PROBLEM — frustration, chaos, wasted time, missed opportunities. Emotionally resonant scenes of the pain point. Dark/moody lighting, tension, discomfort. Each image must depict a DIFFERENT specific frustration scenario.`,
  interest: `GOAL: Introduce the product CATEGORY as a solution — not the product itself yet. Educational content about how this type of solution can help. Light mentions of the product are okay but keep the focus on educating. Position the audience to start looking for a solution.
IMAGE DIRECTION: Show the CATEGORY solution in action — educational diagrams, infographic-style visuals, before/after contrasts, lightbulb moments. Brighter than awareness. Each image should visualize a different educational concept or insight.`,
  consideration: `GOAL: Direct product positioning. Highlight specific features, benefits, and what makes this product different from alternatives. Use the competitive insights from research to create contrast. Include specific, concrete details — not vague claims.
IMAGE DIRECTION: Show the PRODUCT's unique strengths — feature visualizations, comparison metaphors, quality details, craftsmanship. Professional, confident, polished. Each image should highlight a different product advantage or feature.`,
  trial: `GOAL: Drive sign-ups, trials, or first purchases. Create urgency without being pushy. Use social proof, risk reversal (free trial, money-back guarantee), and clear CTAs. Address the "why now" question — give a reason to act today, not next week.
IMAGE DIRECTION: Show TRANSFORMATION and social proof — happy users, celebration moments, achievement, community. Warm, inviting, aspirational. Each image should depict a different success scenario or social proof angle.`,
  activation: `GOAL: Help new users succeed quickly. Share onboarding tips, quick wins, and "did you know" features. The goal is to get users to their first success moment as fast as possible. Think "power user tips for beginners."
IMAGE DIRECTION: Show QUICK WINS — productivity, efficiency, "aha" moments of discovery, clean organized workflows. Bright, energetic, empowering. Each image should illustrate a different tip or quick-win scenario.`,
  retention: `GOAL: Reinforce the value for existing users. Share advanced use cases, success stories, community highlights, and features they might not know about. Make users feel smart for choosing this product. Build loyalty and word-of-mouth.
IMAGE DIRECTION: Show MASTERY and community — expert-level use, team collaboration, growth metrics, community events. Premium, sophisticated, aspirational. Each image should depict a different advanced use case or community moment.`,
};

// Priority order for stages when we have fewer posts than stages
const STAGE_PRIORITY: PipelineStage[] = [
  'awareness', 'consideration', 'trial', 'interest', 'activation', 'retention',
];

function distributePostsAcrossStages(
  totalPosts: number,
  stages: PipelineStage[],
): Map<PipelineStage, number> {
  const distribution = new Map<PipelineStage, number>();

  // If fewer posts than stages, pick the most impactful stages
  if (totalPosts < stages.length) {
    const prioritized = STAGE_PRIORITY.filter((s) => stages.includes(s)).slice(0, totalPosts);
    for (const stage of prioritized) {
      distribution.set(stage, 1);
    }
    return distribution;
  }

  // Calculate raw distribution based on weights
  const totalWeight = stages.reduce((sum, s) => sum + STAGE_WEIGHTS[s], 0);
  let assigned = 0;

  for (const stage of stages) {
    const count = Math.round((STAGE_WEIGHTS[stage] / totalWeight) * totalPosts);
    distribution.set(stage, Math.max(1, count));
    assigned += distribution.get(stage)!;
  }

  // Adjust to match totalPosts exactly
  const diff = totalPosts - assigned;
  if (diff !== 0) {
    // Add/remove from the largest stage
    const largest = stages.reduce((a, b) =>
      (distribution.get(a)! >= distribution.get(b)!) ? a : b
    );
    distribution.set(largest, distribution.get(largest)! + diff);
  }

  return distribution;
}

function formatResearchContext(brief: ResearchBrief): string {
  const parts: string[] = ['--- MARKET RESEARCH ---'];

  if (brief.competitors.length > 0) {
    parts.push('\nCOMPETITORS:');
    for (const c of brief.competitors) {
      parts.push(`- ${c.name}: ${c.positioning} | Strengths: ${c.strengths} | Weaknesses: ${c.weaknesses}`);
    }
  }

  if (brief.trends.length > 0) {
    parts.push('\nTRENDS TO LEVERAGE:');
    for (const t of brief.trends) {
      parts.push(`- ${t.trend}: ${t.contentAngle}`);
    }
  }

  if (brief.newsHookHeadlines && brief.newsHookHeadlines.length > 0) {
    parts.push('\nTIMELY NEWS HOOKS (use these for newsjacking angles where relevant):');
    for (const headline of brief.newsHookHeadlines) {
      parts.push(`- ${headline}`);
    }
  }

  const pi = brief.productInsights;
  parts.push('\nPRODUCT INSIGHTS:');
  parts.push(`Unique value: ${pi.uniqueValueProp}`);
  if (pi.keyMessages.length > 0) parts.push(`Key messages: ${pi.keyMessages.join(' | ')}`);
  if (pi.audiencePainPoints.length > 0) parts.push(`Pain points: ${pi.audiencePainPoints.join(' | ')}`);
  if (pi.toneRecommendations) parts.push(`Tone guidance: ${pi.toneRecommendations}`);

  parts.push('--- END RESEARCH ---');
  return parts.join('\n');
}

function getMostRestrictiveChannel(channels: SocialChannel[]): SocialChannel {
  const priority: SocialChannel[] = ['tiktok', 'instagram', 'facebook'];
  for (const ch of priority) {
    if (channels.includes(ch)) return ch;
  }
  return channels[0];
}

async function generateStageContent(
  client: OpenAI,
  input: GeneratePipelineInput,
  stage: PipelineStage,
  count: number,
  sequenceOffset: number,
): Promise<PipelinePost[]> {
  const primaryChannel = getMostRestrictiveChannel(input.pipelineConfig.channels);
  const channelConstraints = getChannelConstraints(primaryChannel, 'social_post');
  const researchContext = formatResearchContext(input.researchBrief);

  let systemPrompt = SYSTEM_PROMPT;
  if (input.brandVoice) {
    systemPrompt += buildBrandVoiceBlock(input.brandVoice);
  }

  systemPrompt += `\n\nYou are generating content for a multi-post adoption pipeline. Each post is part of a strategic sequence designed to move the audience from awareness to retention over weeks.

UNIQUENESS MANDATE: Make each post RADICALLY different — different hook type, different emotional angle, different storytelling device. Never repeat the same idea, structure, or opening pattern twice.

HOOK VARIETY — use a DIFFERENT hook type for each post:
• Cold open: Drop into a scene mid-action ("You're staring at your inbox at 11pm—")
• Pattern interrupt: Counterintuitive statement ("Stop trying to grow your audience.")
• Identity call-out: Name who they are ("If you're the person everyone calls when—")
• Emotional mirror: Name the unnamed feeling ("That pit in your stomach when—")
• Bold claim with proof: Specific surprising number ("347 teams switched last month.")
• Haunting question: Can't-scroll-past question ("When did you stop enjoying this?")
• Social proof drop: Lead with someone's result ("She changed one thing. Revenue doubled.")

CTA MANDATE: Every single post MUST end with a clear, specific call to action. Not "check us out" — something compelling: "Start your free trial", "DM us SCALE", "Save this for later 📌", "Tag someone who needs this", "Link in bio", "Comment YES if this is you".`;


  const userPrompt = `${researchContext}

--- PRODUCT ---
Name: ${input.productName}
What it does: ${input.productDescription}
Category: ${input.productCategories.join(', ')}
--- END PRODUCT ---

${channelConstraints}

PIPELINE STAGE: ${stage.toUpperCase()} (posts ${sequenceOffset + 1}-${sequenceOffset + count} of ${input.pipelineConfig.postCount} total)
${STAGE_GOALS[stage]}

Cross-posting to: ${input.pipelineConfig.channels.join(', ')} — content must work across all these channels. Size content for the most restrictive channel (${primaryChannel}).

Generate exactly ${count} unique posts for this stage. Each post must have a different angle, hook, or pain point. Variety is critical — do not repeat themes.

CRITICAL LENGTH RULES:
- Each post: 1-2 sentences MAX. Brevity is everything.
- Every word must earn its place. Cut ruthlessly.
- Do NOT write paragraphs, lists, or multi-line posts.

IMAGE PROMPT RULES:
For each post, write a unique, detailed image prompt that creates a VISUALLY DISTINCT scene. Each image must look NOTHING like any other image in this pipeline. If two images could be confused for each other, you have failed.

MANDATORY: Each image prompt must specify ALL of these elements, and NO TWO posts can share the same choice for ANY element:
- SUBJECT TYPE (pick a DIFFERENT one per post): solo hands close-up | single object still life | environmental landscape | abstract texture | two people interacting | overhead arrangement | silhouette | macro detail | point-of-view shot | motion blur action | architectural space | nature close-up | cultural scene | empty space with traces
- LIGHTING (pick a DIFFERENT one per post): Rembrandt dramatic | soft window diffused | neon colored | golden hour backlit | harsh midday shadows | candlelit warm | blue hour twilight | dappled through leaves | studio rim light | overexposed dreamy
- COLOR MOOD (pick a DIFFERENT one per post): warm earth tones | cool oceanic blues | single vibrant accent on muted | dusty pastels | high contrast monochrome | jewel tones | sun-bleached naturals | film noir shadows | botanical greens | warm metallics

NOT ALL IMAGES SHOULD HAVE PEOPLE. At least 40% of images should feature objects, textures, environments, or abstract compositions WITHOUT any human subjects. Show the product world through still life, macro photography, landscapes, architecture, or symbolic arrangements.

The image prompt should be 3-4 sentences describing a SPECIFIC, CINEMATIC scene — as if describing a single frame from a film. Include the exact setting, exact lighting direction, exact colors, and exact emotional tone. Generic descriptions like "person smiling with product" are FORBIDDEN.

Return ONLY valid JSON array, no other text:
[
  { "content": "The post text", "theme": "2-4 word theme label", "imagePrompt": "Detailed unique image scene description" }
]`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 4096,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Return a JSON object with a "posts" array. ${userPrompt}` },
    ],
  });

  const text = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(text);
  const posts: Array<{ content: string; theme: string; imagePrompt?: string }> = parsed.posts || [];

  return posts.map((p, i) => ({
    content: p.content,
    pipelineStage: stage,
    pipelineSequence: sequenceOffset + i,
    pipelineTheme: p.theme,
    imagePrompt: p.imagePrompt || p.content,
  }));
}

export async function generatePipelinePosts(input: GeneratePipelineInput): Promise<PipelinePost[]> {
  const client = getClient();
  const stages = input.pipelineConfig.stages as PipelineStage[];
  const distribution = distributePostsAcrossStages(input.pipelineConfig.postCount, stages);

  // Generate only stages that have posts assigned
  let sequenceOffset = 0;
  const stageEntries: Array<{ stage: PipelineStage; count: number; offset: number }> = [];

  for (const stage of stages) {
    const count = distribution.get(stage);
    if (!count) continue;
    stageEntries.push({ stage, count, offset: sequenceOffset });
    sequenceOffset += count;
  }

  const results = await Promise.all(
    stageEntries.map(({ stage, count, offset }) =>
      generateStageContent(client, input, stage, count, offset)
    )
  );

  return results.flat();
}
