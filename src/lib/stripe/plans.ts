export type PlanTier = 'free' | 'starter' | 'pro' | 'business';
export type BillingInterval = 'monthly' | 'annual';

export type PlanLimits = {
  /** Products ("brands") the subscription covers. -1 = unlimited. */
  brands: number;
  /** Channel connections per brand (one per platform, plus slack for the FB page + IG account pairing). */
  channelsPerBrand: number;
  mediaUploads: number; // per month, -1 = unlimited
  postsPerMonth: number; // -1 = unlimited (all paid tiers)
  teamMembers: number; // -1 = unlimited
  workspaces: number; // -1 = unlimited
  analyticsWindowDays: number; // -1 = unlimited history
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
      '20 media uploads / month',
      'Analytics (7-day window)',
    ],
    limits: {
      brands: 1,
      channelsPerBrand: 2,
      mediaUploads: 20,
      postsPerMonth: 15,
      teamMembers: 1,
      workspaces: 1,
      analyticsWindowDays: 7,
    },
    gated: {
      smartScheduling: false,
      brandIdentity: false,
      prioritySupport: false,
      analyticsCsvExport: false,
    },
  },
  starter: {
    tier: 'starter',
    name: 'Starter',
    description: 'For solo marketers scheduling across every platform.',
    price: { monthly: 29, annual: 24 },
    highlighted: false,
    features: [
      '2 brands across all 6 platforms',
      'Up to 8 channels per brand',
      'Unlimited scheduled posts',
      'Content calendar',
      'Brand voice per brand',
      '500 media uploads / month',
      'Full publishing API',
      'Analytics (30-day window)',
    ],
    limits: {
      brands: 2,
      channelsPerBrand: 8,
      mediaUploads: 500,
      postsPerMonth: -1,
      teamMembers: 1,
      workspaces: 1,
      analyticsWindowDays: 30,
    },
    gated: {
      smartScheduling: false,
      brandIdentity: false,
      prioritySupport: false,
      analyticsCsvExport: false,
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
      '5,000 media uploads / month',
      'Analytics (1-year window)',
      'Priority support',
    ],
    limits: {
      brands: 6,
      channelsPerBrand: 8,
      mediaUploads: 5000,
      postsPerMonth: -1,
      teamMembers: 5,
      workspaces: 5,
      analyticsWindowDays: 365,
    },
    gated: {
      smartScheduling: true,
      brandIdentity: true,
      prioritySupport: true,
      analyticsCsvExport: false,
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
      'Unlimited media uploads',
      'Unlimited analytics history + CSV export',
      'Priority support',
    ],
    limits: {
      brands: 20,
      channelsPerBrand: 8,
      mediaUploads: -1,
      postsPerMonth: -1,
      teamMembers: -1,
      workspaces: -1,
      analyticsWindowDays: -1,
    },
    gated: {
      smartScheduling: true,
      brandIdentity: true,
      prioritySupport: true,
      analyticsCsvExport: true,
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
      { name: 'Channels per brand', starter: '8', pro: '8', business: '8' },
      { name: 'Platforms (Facebook, Instagram, TikTok, Threads, Pinterest, LinkedIn)', starter: true, pro: true, business: true },
      { name: 'Scheduled posts', starter: 'Unlimited', pro: 'Unlimited', business: 'Unlimited' },
      { name: 'Content calendar', starter: true, pro: true, business: true },
      { name: 'Best-time posting recommendations', starter: false, pro: true, business: true },
    ],
  },
  {
    name: 'Media Library',
    features: [
      { name: 'Media uploads', starter: '500/mo', pro: '5,000/mo', business: 'Unlimited' },
      { name: 'Brand voice', starter: 'Per brand', pro: 'Per brand', business: 'Per brand' },
      { name: 'Brand identity (logo & colors)', starter: false, pro: true, business: true },
    ],
  },
  {
    name: 'Analytics',
    features: [
      { name: 'Post & follower analytics', starter: true, pro: true, business: true },
      { name: 'History window', starter: '30 days', pro: '1 year', business: 'Unlimited' },
      { name: 'CSV export', starter: false, pro: false, business: true },
    ],
  },
  {
    name: 'Team & Workspace',
    features: [
      { name: 'Team members', starter: '1', pro: '5 (+ add-on seats)', business: 'Unlimited' },
      { name: 'Workspaces', starter: '1', pro: '5', business: 'Unlimited' },
      { name: 'Role-based access control', starter: true, pro: true, business: true },
    ],
  },
  {
    // API access is not plan-gated among paid tiers: key creation checks
    // role, verified email, and an active subscription — never the tier.
    name: 'Developers & AI Agents',
    features: [
      { name: 'Workspace API keys', starter: true, pro: true, business: true },
      { name: 'Publishing API (Connect + full v1)', starter: true, pro: true, business: true },
      { name: 'Signed webhooks', starter: true, pro: true, business: true },
      { name: 'Per-brand key scoping & expiry', starter: true, pro: true, business: true },
    ],
  },
  {
    name: 'Support',
    features: [
      { name: 'Email support', starter: true, pro: true, business: true },
      { name: 'Priority support', starter: false, pro: true, business: true },
    ],
  },
];
