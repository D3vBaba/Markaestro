export type PlanTier = 'starter' | 'pro' | 'business';
export type BillingInterval = 'monthly' | 'annual';

export type PlanConfig = {
  tier: PlanTier;
  name: string;
  description: string;
  price: { monthly: number; annual: number };
  highlighted: boolean;
  badge?: string;
  features: string[];
  limits: {
    channels: number;
    aiGenerations: number; // -1 = unlimited
    videoGenerations: number; // -1 = unlimited; 0 = not available
    teamMembers: number;   // -1 = unlimited
    workspaces: number;    // -1 = unlimited
  };
  gated: {
    ads: boolean;
    advancedAnalytics: boolean;
    approvalWorkflows: boolean;
    smartScheduling: boolean;
    brandIdentity: boolean;
    prioritySupport: boolean;
  };
};

export const PLANS: Record<PlanTier, PlanConfig> = {
  starter: {
    tier: 'starter',
    name: 'Starter',
    description: 'For solo marketers publishing across channels.',
    price: { monthly: 39, annual: 32 },
    highlighted: false,
    features: [
      '5 social channels',
      'Unlimited posts',
      '30 AI generations / month (text & images)',
      '1 team member',
      'Content calendar',
      'Basic analytics',
      '1 workspace',
      'Brand voice (1 profile)',
    ],
    limits: {
      channels: 5,
      aiGenerations: 30,
      videoGenerations: 0,
      teamMembers: 1,
      workspaces: 1,
    },
    gated: {
      ads: false,
      advancedAnalytics: false,
      approvalWorkflows: false,
      smartScheduling: false,
      brandIdentity: false,
      prioritySupport: false,
    },
  },
  pro: {
    tier: 'pro',
    name: 'Pro',
    description: 'For growing teams that need ads, AI, and collaboration.',
    price: { monthly: 99, annual: 82 },
    highlighted: true,
    badge: 'Most Popular',
    features: [
      '15 social channels',
      'Unlimited posts',
      '150 AI generations / month (text & images)',
      '15 video generations / month',
      '5 team members',
      'Ad campaign management (Meta, Google, TikTok)',
      'Advanced analytics & AI insights',
      '5 workspaces',
      'Brand voice + brand identity',
      'Approval workflows',
      'Smart scheduling',
      'Priority support',
    ],
    limits: {
      channels: 15,
      aiGenerations: 150,
      videoGenerations: 15,
      teamMembers: 5,
      workspaces: 5,
    },
    gated: {
      ads: true,
      advancedAnalytics: true,
      approvalWorkflows: true,
      smartScheduling: true,
      brandIdentity: true,
      prioritySupport: true,
    },
  },
  business: {
    tier: 'business',
    name: 'Business',
    description: 'For agencies managing multiple brands at scale.',
    price: { monthly: 299, annual: 249 },
    highlighted: false,
    features: [
      '50 social channels',
      'Unlimited posts',
      '500 AI generations / month (text & images)',
      '50 video generations / month',
      'Unlimited team members',
      'Everything in Pro',
      'Unlimited workspaces',
      'Priority support',
    ],
    limits: {
      channels: 50,
      aiGenerations: 500,
      videoGenerations: 50,
      teamMembers: -1,
      workspaces: -1,
    },
    gated: {
      ads: true,
      advancedAnalytics: true,
      approvalWorkflows: true,
      smartScheduling: true,
      brandIdentity: true,
      prioritySupport: true,
    },
  },
};

export const PLAN_TIERS = Object.keys(PLANS) as PlanTier[];

export const TRIAL_DAYS = 7;

export const COMPARISON_CATEGORIES = [
  {
    name: 'Publishing',
    features: [
      { name: 'Social channels', starter: '5', pro: '15', business: '50' },
      { name: 'Posts per month', starter: 'Unlimited', pro: 'Unlimited', business: 'Unlimited' },
      { name: 'Content calendar', starter: true, pro: true, business: true },
      { name: 'Bulk scheduling', starter: false, pro: true, business: true },
      { name: 'Smart scheduling', starter: false, pro: true, business: true },
    ],
  },
  {
    name: 'AI Generation',
    features: [
      { name: 'Text & image generations', starter: '30/mo', pro: '150/mo', business: '500/mo' },
      { name: 'Video generations', starter: '—', pro: '15/mo', business: '50/mo' },
      { name: 'Brand voice profiles', starter: '1', pro: '5', business: 'Unlimited' },
      { name: 'Brand identity (logo & colors)', starter: false, pro: true, business: true },
    ],
  },
  {
    name: 'Advertising',
    features: [
      { name: 'Meta Ads', starter: false, pro: true, business: true },
      { name: 'Google Ads', starter: false, pro: true, business: true },
      { name: 'TikTok Ads', starter: false, pro: true, business: true },
      { name: 'Advanced analytics & AI insights', starter: false, pro: true, business: true },
    ],
  },
  {
    name: 'Team & Workspace',
    features: [
      { name: 'Team members', starter: '1', pro: '5', business: 'Unlimited' },
      { name: 'Workspaces', starter: '1', pro: '5', business: 'Unlimited' },
      { name: 'Approval workflows', starter: false, pro: true, business: true },
      { name: 'Role-based access control', starter: true, pro: true, business: true },
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
