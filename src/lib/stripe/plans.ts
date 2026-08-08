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
    mediaUploads: number; // -1 = unlimited
    teamMembers: number;  // -1 = unlimited
    workspaces: number;   // -1 = unlimited
    analyticsWindowDays: number; // -1 = unlimited history
  };
  gated: {
    smartScheduling: boolean;
    brandIdentity: boolean;
    prioritySupport: boolean;
    analyticsCsvExport: boolean;
  };
};

export const PLANS: Record<PlanTier, PlanConfig> = {
  starter: {
    tier: 'starter',
    name: 'Starter',
    description: 'For solo marketers publishing across Meta and TikTok.',
    price: { monthly: 29, annual: 24 },
    highlighted: false,
    features: [
      '5 social channels',
      'Unlimited posts',
      '500 media uploads / month',
      '1 team member',
      'Content calendar',
      '1 workspace',
      'Brand voice (1 profile)',
      'Analytics (7-day window)',
    ],
    limits: {
      channels: 5,
      mediaUploads: 500,
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
  pro: {
    tier: 'pro',
    name: 'Pro',
    description: 'For growing teams that need collaboration and scheduling.',
    price: { monthly: 69, annual: 57 },
    highlighted: true,
    badge: 'Most Popular',
    features: [
      '15 social channels',
      'Unlimited posts',
      '5,000 media uploads / month',
      '5 team members',
      '5 workspaces',
      'Brand voice + brand identity',
      'Smart scheduling',
      'Analytics (90-day window)',
      'Priority support',
    ],
    limits: {
      channels: 15,
      mediaUploads: 5000,
      teamMembers: 5,
      workspaces: 5,
      analyticsWindowDays: 90,
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
    description: 'For agencies managing multiple brands at scale.',
    price: { monthly: 199, annual: 165 },
    highlighted: false,
    features: [
      '50 social channels',
      'Unlimited posts',
      'Unlimited media uploads',
      'Unlimited team members',
      'Everything in Pro',
      'Unlimited workspaces',
      'Unlimited analytics history + CSV export',
      'Priority support',
    ],
    limits: {
      channels: 50,
      mediaUploads: -1,
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
    name: 'Media Library',
    features: [
      { name: 'Media uploads', starter: '500/mo', pro: '5,000/mo', business: 'Unlimited' },
      { name: 'Brand voice profiles', starter: '1', pro: '5', business: 'Unlimited' },
      { name: 'Brand identity (logo & colors)', starter: false, pro: true, business: true },
    ],
  },
  {
    name: 'Analytics',
    features: [
      { name: 'Post & follower analytics', starter: true, pro: true, business: true },
      { name: 'History window', starter: '7 days', pro: '90 days', business: 'Unlimited' },
      { name: 'CSV export', starter: false, pro: false, business: true },
    ],
  },
  {
    name: 'Team & Workspace',
    features: [
      { name: 'Team members', starter: '1', pro: '5', business: 'Unlimited' },
      { name: 'Workspaces', starter: '1', pro: '5', business: 'Unlimited' },
      { name: 'Role-based access control', starter: true, pro: true, business: true },
    ],
  },
  {
    // API access is not plan-gated: key creation checks role and verified
    // email, never the subscription tier. Every row here is intentionally
    // true across all three plans.
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
