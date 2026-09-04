export type PlanTier = 'free' | 'starter' | 'pro' | 'business';
export type BillingInterval = 'monthly' | 'annual';

export type PlanLimits = {
  /** Products ("brands") the subscription covers. -1 = unlimited. */
  brands: number;
  /** Channel connections per brand (one per platform, plus slack for the FB page + IG account pairing). */
  channelsPerBrand: number;
  storageGb: number; // cumulative media storage cap, -1 = unlimited
  postsPerMonth: number; // -1 = unlimited (all paid tiers)
  apiRequestsPerMinute: number; // public API per-route throughput; 60 is the Starter baseline, 0 = no API access
  teamMembers: number; // -1 = unlimited
  workspaces: number; // -1 = unlimited
  analyticsWindowDays: number; // -1 = unlimited history
  intelligenceAiOperationsPerMonth: number;
  strategistTurnsPerMonth: number;
  /** Active Intelligent Evergreen queues per brand. -1 = unlimited. */
  evergreenQueuesPerBrand: number;
};

export type PlanConfig = {
  tier: PlanTier;
  name: string;
  description: string;
  price: { monthly: number; annual: number };
  highlighted: boolean;
  badge?: string;
  features: string[];
  limits: PlanLimits;
  gated: {
    smartScheduling: boolean;
    brandIdentity: boolean;
    prioritySupport: boolean;
    analyticsCsvExport: boolean;
    audienceFit: boolean;
    intelligenceOptimization: boolean;
    intelligenceStrategist: boolean;
    intelligenceExperiments: boolean;
    evergreenOptimization: boolean;
  };
};

export const PLANS: Record<PlanTier, PlanConfig> = {
  /**
   * The tier every workspace without an active subscription resolves to —
   * lapsed, canceled, and never-subscribed alike. Not purchasable and not
   * rendered on the pricing page (PLAN_TIERS excludes it).
   */
  free: {
    tier: 'free',
    name: 'Free',
    description: 'Try Markaestro with one brand.',
    price: { monthly: 0, annual: 0 },
    highlighted: false,
    features: [
      '1 brand, 2 channels',
      '15 posts / month',
      'Content calendar',
      '1 GB storage',
      'Analytics (7-day window)',
    ],
    limits: {
      brands: 1,
      channelsPerBrand: 2,
      storageGb: 1,
      postsPerMonth: 15,
      teamMembers: 1,
      workspaces: 1,
      analyticsWindowDays: 7,
      apiRequestsPerMinute: 0,
      intelligenceAiOperationsPerMonth: 5,
      strategistTurnsPerMonth: 0,
      evergreenQueuesPerBrand: 0,
    },
    gated: {
      smartScheduling: false,
      brandIdentity: false,
      prioritySupport: false,
      analyticsCsvExport: false,
      audienceFit: true,
      intelligenceOptimization: false,
      intelligenceStrategist: false,
      intelligenceExperiments: false,
      evergreenOptimization: false,
    },
  },
  starter: {
    tier: 'starter',
    name: 'Starter',
    description: 'For solo marketers scheduling across every platform.',
    price: { monthly: 29, annual: 24 },
    highlighted: false,
    features: [
      '2 brands across all 7 platforms',
      'Up to 8 channels per brand',
      'Unlimited scheduled posts',
      'Content calendar',
      'Brand voice per brand',
      '10 GB storage',
      'Full publishing API',
      'Analytics (30-day window)',
    ],
    limits: {
      brands: 2,
      channelsPerBrand: 8,
      storageGb: 10,
      postsPerMonth: -1,
      teamMembers: 1,
      workspaces: 1,
      analyticsWindowDays: 30,
      apiRequestsPerMinute: 60,
      intelligenceAiOperationsPerMonth: 30,
      strategistTurnsPerMonth: 0,
      evergreenQueuesPerBrand: 0,
    },
    gated: {
      smartScheduling: false,
      brandIdentity: false,
      prioritySupport: false,
      analyticsCsvExport: false,
      audienceFit: true,
      intelligenceOptimization: false,
      intelligenceStrategist: false,
      intelligenceExperiments: false,
      evergreenOptimization: false,
    },
  },
  pro: {
    tier: 'pro',
    name: 'Pro',
    description: 'For growing teams managing several brands.',
    price: { monthly: 69, annual: 57 },
    highlighted: true,
    badge: 'Most Popular',
    features: [
      '6 brands',
      '5 team members with roles',
      '5 workspaces',
      'Best-time posting recommendations',
      'Brand voice + brand identity (logo & colors)',
      '100 GB storage',
      'Analytics (1-year window)',
      'Priority support',
      '10 Intelligent Evergreen queues per brand',
    ],
    limits: {
      brands: 6,
      channelsPerBrand: 8,
      storageGb: 100,
      postsPerMonth: -1,
      teamMembers: 5,
      workspaces: 5,
      analyticsWindowDays: 365,
      apiRequestsPerMinute: 120,
      intelligenceAiOperationsPerMonth: 300,
      strategistTurnsPerMonth: 30,
      evergreenQueuesPerBrand: 10,
    },
    gated: {
      smartScheduling: true,
      brandIdentity: true,
      prioritySupport: true,
      analyticsCsvExport: false,
      audienceFit: true,
      intelligenceOptimization: true,
      intelligenceStrategist: true,
      intelligenceExperiments: false,
      evergreenOptimization: true,
    },
  },
  business: {
    tier: 'business',
    name: 'Business',
    description: 'For agencies managing many brands at scale.',
    price: { monthly: 199, annual: 165 },
    highlighted: false,
    features: [
      '20 brands',
      'Unlimited team members & workspaces',
      'Unlimited storage',
      'Unlimited analytics history + CSV export',
      'Priority support',
      'Unlimited Intelligent Evergreen queues',
    ],
    limits: {
      brands: 20,
      channelsPerBrand: 8,
      storageGb: -1,
      postsPerMonth: -1,
      teamMembers: -1,
      workspaces: -1,
      analyticsWindowDays: -1,
      apiRequestsPerMinute: 300,
      intelligenceAiOperationsPerMonth: 2000,
      strategistTurnsPerMonth: 300,
      evergreenQueuesPerBrand: -1,
    },
    gated: {
      smartScheduling: true,
      brandIdentity: true,
      prioritySupport: true,
      analyticsCsvExport: true,
      audienceFit: true,
      intelligenceOptimization: true,
      intelligenceStrategist: true,
      intelligenceExperiments: true,
      evergreenOptimization: true,
    },
  },
};

/** Purchasable tiers, in display order. Excludes 'free'. */
export const PLAN_TIERS: PlanTier[] = ['starter', 'pro', 'business'];

export const TRIAL_DAYS = 7;

export type AddonKey = 'brand' | 'seat';

/**
 * Subscription add-ons, purchased as extra Stripe subscription items.
 * `availableOn` is the set of base tiers the add-on can be attached to:
 * brand packs make no sense on Business (20 brands, then talk to us), and
 * seats below Pro are the Pro upgrade trigger, not an add-on.
 */
export const ADDONS: Record<AddonKey, {
  name: string;
  price: { monthly: number; annual: number };
  availableOn: PlanTier[];
}> = {
  brand: {
    name: 'Extra brand',
    price: { monthly: 10, annual: 100 },
    availableOn: ['starter', 'pro'],
  },
  seat: {
    name: 'Extra seat',
    price: { monthly: 5, annual: 50 },
    availableOn: ['pro'],
  },
};

export const COMPARISON_CATEGORIES = [
  {
    name: 'Publishing',
    features: [
      { name: 'Brands', starter: '2', pro: '6', business: '20' },
      { name: 'Channels per Brand', starter: '8', pro: '8', business: '8' },
      { name: 'Platforms (Facebook, Instagram, TikTok, Threads, Pinterest, LinkedIn, X)', starter: true, pro: true, business: true },
      { name: 'Scheduled Posts', starter: 'Unlimited', pro: 'Unlimited', business: 'Unlimited' },
      { name: 'Content Calendar', starter: true, pro: true, business: true },
      { name: 'Best-Time Posting Recommendations', starter: false, pro: true, business: true },
    ],
  },
  {
    name: 'Media Library',
    features: [
      { name: 'Storage', starter: '10 GB', pro: '100 GB', business: 'Unlimited' },
      { name: 'Brand Voice', starter: 'Per brand', pro: 'Per brand', business: 'Per brand' },
      { name: 'Brand Identity (Logo & Colors)', starter: false, pro: true, business: true },
    ],
  },
  {
    name: 'Analytics',
    features: [
      { name: 'Post & Follower Analytics', starter: true, pro: true, business: true },
      { name: 'History Window', starter: '30 days', pro: '1 year', business: 'Unlimited' },
      { name: 'CSV Export', starter: false, pro: false, business: true },
    ],
  },
  {
    name: 'Team & Workspace',
    features: [
      { name: 'Team Members', starter: '1', pro: '5 (+ add-on seats)', business: 'Unlimited' },
      { name: 'Workspaces', starter: '1', pro: '5', business: 'Unlimited' },
      { name: 'Role-Based Access Control', starter: true, pro: true, business: true },
    ],
  },
  {
    // API access is not feature-gated among paid tiers: key creation checks
    // role, verified email, and an active subscription — never the tier.
    // Throughput is the tier difference: request budgets scale with
    // limits.apiRequestsPerMinute.
    name: 'Developers & AI Agents',
    features: [
      { name: 'Workspace API Keys', starter: true, pro: true, business: true },
      { name: 'Publishing API (Connect + Full v1)', starter: true, pro: true, business: true },
      { name: 'Signed Webhooks', starter: true, pro: true, business: true },
      { name: 'Per-Brand Key Scoping & Expiry', starter: true, pro: true, business: true },
      { name: 'API Rate Limit', starter: '60 req/min', pro: '120 req/min', business: '300 req/min' },
    ],
  },
  {
    name: 'Support',
    features: [
      { name: 'Email Support', starter: true, pro: true, business: true },
      { name: 'Priority Support', starter: false, pro: true, business: true },
    ],
  },
];
