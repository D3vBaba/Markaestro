"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { useOnboardingStatus } from "@/components/providers/useOnboardingStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-client";
import { PLANS, TRIAL_DAYS } from "@/lib/stripe/plans";
import type { PlanTier, BillingInterval } from "@/lib/stripe/plans";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

// ─── Quiz data ────────────────────────────────────────────────────────────────

const ROLES = [
  { id: "founder", label: "Founder / CEO", desc: "Building and growing my company" },
  { id: "marketer", label: "Marketer", desc: "Running campaigns and content" },
  { id: "agency", label: "Agency / Freelancer", desc: "Managing multiple clients" },
  { id: "creator", label: "Content Creator", desc: "Growing my personal brand" },
];

const TEAM_SIZES = [
  { id: "solo", label: "Just me", desc: "Solo founder or independent" },
  { id: "small", label: "2–5 people", desc: "Small but mighty" },
  { id: "medium", label: "6–20 people", desc: "Growing team" },
  { id: "large", label: "20+ people", desc: "Established organisation" },
];

const GOALS = [
  { id: "social", label: "Grow social following", desc: "Build audience and engagement" },
  { id: "sales", label: "Drive more sales", desc: "Convert leads into customers" },
  { id: "ads", label: "Manage ad campaigns", desc: "Optimise paid acquisition" },
  { id: "time", label: "Save time on content", desc: "Automate repetitive tasks" },
];

const CHANNELS = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "tiktok", label: "TikTok" },
  { id: "google", label: "Google Ads" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "twitter", label: "X / Twitter" },
];

const SOCIAL_PROVIDERS = [
  {
    id: "meta",
    label: "Meta",
    description: "Connect Facebook and Instagram",
    note: "Pages, Reels, Feed posts, Stories",
  },
  {
    id: "google",
    label: "Google Ads",
    description: "Connect your Google Ads account",
    note: "Search, Display, Performance Max",
  },
];

// ─── Plan recommender ─────────────────────────────────────────────────────────

function recommendPlan(role: string, teamSize: string, goal: string): PlanTier {
  if (role === "agency" || teamSize === "large" || teamSize === "medium") return "business";
  if (goal === "ads" || teamSize === "small" || role === "marketer") return "pro";
  return "starter";
}

// ─── Persisted state ──────────────────────────────────────────────────────────

const STORAGE_KEY = "onboarding_state_v2";

type PersistedState = {
  step: number;
  role: string;
  teamSize: string;
  goal: string;
  channels: string[];
  productUrl: string;
  productName: string;
  productDesc: string;
  productCategory: string;
  productPricingTier: string;
  productTags: string[];
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string;
  tone: string;
  targetAudience: string;
  selectedTier: PlanTier;
  interval: BillingInterval;
  connected: Record<string, boolean>;
};

function loadState(): Partial<PersistedState> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

const TOTAL_STEPS = 6;

function ProgressBar({ step }: { step: number }) {
  if (step >= 6) return null;
  const pct = Math.round(((step + 1) / TOTAL_STEPS) * 100);
  return (
    <div className="h-0.5 bg-border w-full">
      <motion.div
        className="h-full bg-primary"
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.4, ease }}
      />
    </div>
  );
}

// ─── Selection tile ───────────────────────────────────────────────────────────

function SelectionTile({
  selected,
  onClick,
  label,
  desc,
  delay = 0,
  multi = false,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  desc?: string;
  delay?: number;
  multi?: boolean;
}) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.28, ease }}
      className={cn(
        "w-full rounded-xl border p-5 text-left transition-all duration-150 min-h-[72px] active:scale-[0.99]",
        selected
          ? "border-primary bg-primary/3 shadow-sm"
          : "border-border hover:border-foreground/30 hover:shadow-sm"
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-base font-medium text-foreground leading-snug">{label}</p>
          {desc && (
            <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
          )}
        </div>
        <div
          className={cn(
            "shrink-0 transition-all",
            multi
              ? cn(
                  "h-5 w-5 rounded border-2 flex items-center justify-center",
                  selected ? "border-primary bg-primary" : "border-muted-foreground/40"
                )
              : cn(
                  "h-5 w-5 rounded-full border-2 flex items-center justify-center",
                  selected ? "border-primary" : "border-muted-foreground/40"
                )
          )}
        >
          {multi && selected && (
            <span className="text-[10px] font-bold text-white leading-none">✓</span>
          )}
          {!multi && selected && (
            <div className="h-2.5 w-2.5 rounded-full bg-primary" />
          )}
        </div>
      </div>
    </motion.button>
  );
}

// ─── Post preview card ────────────────────────────────────────────────────────

function PostPreviewCard({
  content,
  productName,
  primaryColor,
  locked = false,
}: {
  content: string;
  productName: string;
  primaryColor: string;
  locked?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative rounded-xl border bg-background overflow-hidden",
        locked && "select-none"
      )}
    >
      {locked && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/85 backdrop-blur-sm rounded-xl">
          <p className="text-sm font-semibold">Subscribe to publish</p>
          <p className="text-xs text-muted-foreground mt-1">Your post is ready — one step away</p>
        </div>
      )}
      <div className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
            style={{ backgroundColor: primaryColor }}
          >
            {productName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold">{productName}</p>
            <p className="text-xs text-muted-foreground">Just now</p>
          </div>
        </div>
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-line line-clamp-6">
          {content}
        </p>
        <div className="mt-4 pt-4 border-t flex gap-6 text-xs text-muted-foreground">
          <span>Like</span>
          <span>Comment</span>
          <span>Share</span>
        </div>
      </div>
    </div>
  );
}

// ─── Full marketing footer ────────────────────────────────────────────────────

function OnboardingFooter() {
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-3">
              <Image
                src="/markaestro-logo-transparent.png"
                alt="Markaestro"
                width={32}
                height={28}
                className="object-contain"
              />
              <span className="text-sm font-bold tracking-tight">Markaestro</span>
            </div>
            <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
              The premium marketing automation platform for modern teams.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">
              Product
            </p>
            <div className="mt-5 flex flex-col gap-3">
              <Link href="/features" className="text-sm text-muted-foreground hover:text-foreground transition">Features</Link>
              <Link href="/channels" className="text-sm text-muted-foreground hover:text-foreground transition">Channels</Link>
              <Link href="/ai-studio" className="text-sm text-muted-foreground hover:text-foreground transition">AI Studio</Link>
              <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition">Pricing</Link>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">
              Company
            </p>
            <div className="mt-5 flex flex-col gap-3">
              <Link href="/contact" className="text-sm text-muted-foreground hover:text-foreground transition">Contact</Link>
              <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground transition">Terms of Service</Link>
              <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition">Privacy Policy</Link>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">
              Get Started
            </p>
            <div className="mt-5 flex flex-col gap-3">
              <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition">Sign In</Link>
              <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition">Create Account</Link>
            </div>
          </div>
        </div>

        <div className="mt-16 flex flex-col items-center gap-4 border-t pt-8 sm:flex-row sm:justify-between">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Markaestro. All rights reserved.
          </p>
          <div className="flex gap-6">
            <Link href="/terms" className="text-xs text-muted-foreground hover:text-foreground transition">Terms</Link>
            <Link href="/privacy" className="text-xs text-muted-foreground hover:text-foreground transition">Privacy</Link>
            <Link href="/contact" className="text-xs text-muted-foreground hover:text-foreground transition">Contact</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const { loading: subLoading } = useSubscription();
  const { completed, error: onboardingError, loading: onboardingLoading } = useOnboardingStatus();
  const router = useRouter();

  const saved = loadState();

  // Steps: 0=role, 1=team, 2=goal, 3=channels, 4=product, 5=socials, 6=generating, 7=paywall
  const [step, setStep] = useState(saved.step ?? 0);

  const [role, setRole] = useState(saved.role ?? "");
  const [teamSize, setTeamSize] = useState(saved.teamSize ?? "");
  const [goal, setGoal] = useState(saved.goal ?? "");
  const [channels, setChannels] = useState<string[]>(saved.channels ?? []);

  const [productUrl, setProductUrl] = useState(saved.productUrl ?? "");
  const [productName, setProductName] = useState(saved.productName ?? "");
  const [productDesc, setProductDesc] = useState(saved.productDesc ?? "");
  const [productCategory, setProductCategory] = useState(saved.productCategory ?? "saas");
  const [productPricingTier, setProductPricingTier] = useState(saved.productPricingTier ?? "");
  const [productTags, setProductTags] = useState<string[]>(saved.productTags ?? []);
  const [primaryColor, setPrimaryColor] = useState(saved.primaryColor ?? "#6366f1");
  const [secondaryColor, setSecondaryColor] = useState(saved.secondaryColor ?? "");
  const [accentColor, setAccentColor] = useState(saved.accentColor ?? "");
  const [logoUrl, setLogoUrl] = useState(saved.logoUrl ?? "");
  const [tone, setTone] = useState(saved.tone ?? "");
  const [targetAudience, setTargetAudience] = useState(saved.targetAudience ?? "");
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);

  const [connected, setConnected] = useState<Record<string, boolean>>(saved.connected ?? {});
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);

  const [postContent, setPostContent] = useState("");

  const [selectedTier, setSelectedTier] = useState<PlanTier>(saved.selectedTier ?? "pro");
  const [interval, setInterval] = useState<BillingInterval>(saved.interval ?? "annual");
  const [busy, setBusy] = useState(false);

  // ─── Persist state ──────────────────────────────────────────────────────────

  useEffect(() => {
    const snapshot: PersistedState = {
      step, role, teamSize, goal, channels,
      productUrl, productName, productDesc, productCategory, productPricingTier, productTags,
      primaryColor, secondaryColor, accentColor, logoUrl, tone, targetAudience,
      selectedTier, interval, connected,
    };
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* ignore */ }
  }, [
    step, role, teamSize, goal, channels,
    productUrl, productName, productDesc, productCategory, productPricingTier, productTags,
    primaryColor, secondaryColor, accentColor, logoUrl, tone, targetAudience,
    selectedTier, interval, connected,
  ]);

  // ─── Auth guards ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login?next=/onboarding");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!authLoading && !onboardingLoading && (completed || onboardingError)) {
      router.replace("/dashboard");
    }
  }, [authLoading, onboardingLoading, completed, onboardingError, router]);

  // ─── OAuth return ───────────────────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("oauth");
    const oauthProvider = params.get("provider");
    if (oauthResult && oauthProvider) {
      if (oauthResult === "success") {
        setConnected((prev) => ({ ...prev, [oauthProvider]: true }));
        const label = oauthProvider === "meta" ? "Meta (Facebook + Instagram)" : "Google Ads";
        toast.success(`${label} connected`);
      } else {
        toast.error(`Failed to connect ${oauthProvider}`);
      }
      window.history.replaceState({}, "", "/onboarding");
    }
  }, []);

  // ─── Auto-recommend plan ─────────────────────────────────────────────────────

  useEffect(() => {
    if (role && teamSize && goal) {
      setSelectedTier(recommendPlan(role, teamSize, goal));
    }
  }, [role, teamSize, goal]);

  if (authLoading || subLoading || onboardingLoading || !user) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="h-8 w-8 rounded-lg bg-primary animate-pulse" />
      </div>
    );
  }

  if (completed || onboardingError) return null;

  const displayName =
    user.displayName?.split(" ")[0] || user.email?.split("@")[0] || "there";

  // ─── Handlers ───────────────────────────────────────────────────────────────

  async function scanUrl() {
    let url = productUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    setProductUrl(url);
    setScanning(true);
    setScanDone(false);
    try {
      const res = await apiFetch<{
        name: string; description: string; category: string;
        pricingTier: string; tags: string[]; primaryColor: string;
        secondaryColor: string; accentColor: string; logoUrl: string;
        targetAudience: string; tone: string;
      }>("/api/products/scan", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        const d = res.data;
        if (d.name) setProductName(d.name);
        if (d.description) setProductDesc(d.description);
        if (d.category) setProductCategory(d.category);
        if (d.pricingTier) setProductPricingTier(d.pricingTier);
        if (d.tags?.length) setProductTags(d.tags);
        if (d.primaryColor) setPrimaryColor(d.primaryColor);
        if (d.secondaryColor) setSecondaryColor(d.secondaryColor);
        if (d.accentColor) setAccentColor(d.accentColor);
        if (d.logoUrl) setLogoUrl(d.logoUrl);
        if (d.targetAudience) setTargetAudience(d.targetAudience);
        if (d.tone) setTone(d.tone);
        setScanDone(true);
      } else {
        toast.error("Scan failed — please fill in your details manually");
        setManualEntry(true);
      }
    } catch {
      toast.error("Scan failed — please fill in your details manually");
      setManualEntry(true);
    } finally {
      setScanning(false);
    }
  }

  async function connectSocial(providerId: string) {
    setConnectingProvider(providerId);
    try {
      const returnTo = `${window.location.origin}/onboarding`;
      const res = await apiFetch<{ authUrl: string }>(
        `/api/oauth/authorize/${providerId}`,
        { method: "POST", body: JSON.stringify({ returnTo }) }
      );
      if (res.ok && res.data.authUrl) {
        window.location.href = res.data.authUrl;
      } else {
        toast.error("Could not initiate connection. Please try again.");
      }
    } catch {
      toast.error("Could not initiate connection. Please try again.");
    } finally {
      setConnectingProvider(null);
    }
  }

  async function generatePreview() {
    if (!productName || !productDesc) return;
    setStep(6);
    try {
      const primaryChannel = channels[0] || "instagram";
      const res = await apiFetch<{ postContent: string; primaryColor: string; logoUrl: string }>(
        "/api/onboarding/preview",
        {
          method: "POST",
          body: JSON.stringify({
            productName, productDescription: productDesc, productUrl,
            channel: primaryChannel, logoUrl, primaryColor, secondaryColor, accentColor,
            tone: tone || "Professional, engaging", targetAudience,
            category: productCategory, pricingTier: productPricingTier, tags: productTags,
          }),
        }
      );
      if (res.ok) {
        if (res.data.postContent) setPostContent(res.data.postContent);
        if (res.data.primaryColor) setPrimaryColor(res.data.primaryColor);
        if (res.data.logoUrl) setLogoUrl(res.data.logoUrl);
      }
    } catch { /* silent */ } finally {
      setStep(7);
    }
  }

  async function handleCheckout() {
    setBusy(true);
    try {
      const res = await apiFetch<{ url: string }>("/api/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ tier: selectedTier, interval }),
      });
      if (res.ok && res.data.url) window.location.href = res.data.url;
    } catch { /* silent */ } finally {
      setBusy(false);
    }
  }

  function toggleChannel(id: string) {
    setChannels((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col bg-background">

      {/* ── Header — matches MarketingLayout exactly ──────────────────────── */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/markaestro-logo-transparent.png"
              alt="Markaestro"
              width={40}
              height={36}
              className="object-contain"
            />
            <span className="text-base font-bold tracking-tight">Markaestro</span>
          </Link>

          <div className="flex items-center gap-5">
            {step < 6 && (
              <span className="hidden sm:inline text-sm text-muted-foreground tabular-nums">
                Step {step + 1} of {TOTAL_STEPS}
              </span>
            )}
            <button
              className="text-sm text-muted-foreground hover:text-foreground transition"
              onClick={logout}
            >
              Sign out
            </button>
          </div>
        </div>
        <ProgressBar step={step} />
      </header>

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <main className="flex-1 w-full">
        <div className="mx-auto max-w-2xl px-5 sm:px-8 py-12 sm:py-16">
          <AnimatePresence mode="wait">

            {/* ── Step 0: Role ────────────────────────────────────────────── */}
            {step === 0 && (
              <motion.div
                key="role"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.32, ease }}
              >
                <div className="mb-10 sm:mb-12">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-4">
                    Welcome, {displayName}
                  </p>
                  <h1 className="text-3xl sm:text-4xl font-normal tracking-tight font-display leading-tight">
                    What best describes your role?
                  </h1>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                    We&apos;ll personalise Markaestro to how you work.
                  </p>
                </div>
                <div className="grid gap-3">
                  {ROLES.map((r, i) => (
                    <SelectionTile
                      key={r.id}
                      selected={role === r.id}
                      label={r.label}
                      desc={r.desc}
                      delay={i * 0.05}
                      onClick={() => { setRole(r.id); setTimeout(() => setStep(1), 200); }}
                    />
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── Step 1: Team size ───────────────────────────────────────── */}
            {step === 1 && (
              <motion.div
                key="team"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.32, ease }}
              >
                <div className="mb-10 sm:mb-12">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-4">
                    Tell us a bit more
                  </p>
                  <h2 className="text-3xl sm:text-4xl font-normal tracking-tight font-display leading-tight">
                    How big is your team?
                  </h2>
                </div>
                <div className="grid gap-3">
                  {TEAM_SIZES.map((t, i) => (
                    <SelectionTile
                      key={t.id}
                      selected={teamSize === t.id}
                      label={t.label}
                      desc={t.desc}
                      delay={i * 0.05}
                      onClick={() => { setTeamSize(t.id); setTimeout(() => setStep(2), 200); }}
                    />
                  ))}
                </div>
                <button
                  className="mt-8 text-sm text-muted-foreground hover:text-foreground transition"
                  onClick={() => setStep(0)}
                >
                  ← Back
                </button>
              </motion.div>
            )}

            {/* ── Step 2: Primary goal ─────────────────────────────────────── */}
            {step === 2 && (
              <motion.div
                key="goal"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.32, ease }}
              >
                <div className="mb-10 sm:mb-12">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-4">
                    Almost there
                  </p>
                  <h2 className="text-3xl sm:text-4xl font-normal tracking-tight font-display leading-tight">
                    What&apos;s your primary goal?
                  </h2>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                    We&apos;ll recommend the right plan for your needs.
                  </p>
                </div>
                <div className="grid gap-3">
                  {GOALS.map((g, i) => (
                    <SelectionTile
                      key={g.id}
                      selected={goal === g.id}
                      label={g.label}
                      desc={g.desc}
                      delay={i * 0.05}
                      onClick={() => { setGoal(g.id); setTimeout(() => setStep(3), 200); }}
                    />
                  ))}
                </div>
                <button
                  className="mt-8 text-sm text-muted-foreground hover:text-foreground transition"
                  onClick={() => setStep(1)}
                >
                  ← Back
                </button>
              </motion.div>
            )}

            {/* ── Step 3: Channels ─────────────────────────────────────────── */}
            {step === 3 && (
              <motion.div
                key="channels"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.32, ease }}
              >
                <div className="mb-10 sm:mb-12">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-4">
                    Last question
                  </p>
                  <h2 className="text-3xl sm:text-4xl font-normal tracking-tight font-display leading-tight">
                    Which channels do you use?
                  </h2>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                    Pick all that apply. You can add more later.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {CHANNELS.map((c, i) => (
                    <SelectionTile
                      key={c.id}
                      multi
                      selected={channels.includes(c.id)}
                      label={c.label}
                      delay={i * 0.04}
                      onClick={() => toggleChannel(c.id)}
                    />
                  ))}
                </div>
                <div className="mt-8 flex flex-col gap-3">
                  <Button
                    size="lg"
                    className="w-full h-12 rounded-xl text-base"
                    onClick={() => setStep(4)}
                    disabled={channels.length === 0}
                  >
                    Continue
                  </Button>
                  <button
                    className="text-sm text-muted-foreground hover:text-foreground transition text-center"
                    onClick={() => setStep(2)}
                  >
                    ← Back
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Step 4: Product setup ────────────────────────────────────── */}
            {step === 4 && (
              <motion.div
                key="product"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.32, ease }}
              >
                <div className="mb-10 sm:mb-12">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-4">
                    Your product
                  </p>
                  <h2 className="text-3xl sm:text-4xl font-normal tracking-tight font-display leading-tight">
                    Tell us what you&apos;re marketing
                  </h2>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                    Enter your website URL and we&apos;ll scan it with AI to fill in your product details automatically.
                  </p>
                </div>

                {!manualEntry ? (
                  <div className="space-y-5">
                    <div className="rounded-xl border p-5 sm:p-6 space-y-5">
                      <div>
                        <label className="text-sm font-medium text-foreground block mb-2">
                          Website URL
                        </label>
                        <div className="flex gap-2.5">
                          <Input
                            placeholder="yourproduct.com"
                            className="h-12 rounded-lg text-base flex-1"
                            style={{ fontSize: "16px" }}
                            value={productUrl}
                            onChange={(e) => { setProductUrl(e.target.value); setScanDone(false); }}
                            onKeyDown={(e) => e.key === "Enter" && !scanning && scanUrl()}
                          />
                          <Button
                            className="h-12 rounded-lg px-5 shrink-0 text-sm font-medium"
                            onClick={scanUrl}
                            disabled={scanning || !productUrl.trim()}
                            variant={scanDone ? "outline" : "default"}
                          >
                            {scanning ? "Scanning…" : scanDone ? "Re-scan" : "Scan"}
                          </Button>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                          Our AI reads your site and fills in name, description, brand colours, and more.
                        </p>
                      </div>

                      {scanDone && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-4 pt-5 border-t"
                        >
                          <p className="text-sm font-medium text-emerald-600">
                            Scan complete — review and confirm below
                          </p>

                          <div>
                            <label className="text-sm font-medium block mb-2">Product name</label>
                            <Input
                              className="h-11 rounded-lg"
                              style={{ fontSize: "16px" }}
                              value={productName}
                              onChange={(e) => setProductName(e.target.value)}
                            />
                          </div>

                          <div>
                            <label className="text-sm font-medium block mb-2">Description</label>
                            <textarea
                              className="w-full rounded-lg border bg-background px-3 py-3 text-base min-h-[96px] resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 leading-relaxed"
                              style={{ fontSize: "16px" }}
                              value={productDesc}
                              onChange={(e) => setProductDesc(e.target.value)}
                            />
                          </div>

                          <div className="grid sm:grid-cols-2 gap-4">
                            <div>
                              <label className="text-sm font-medium block mb-2">Target audience</label>
                              <Input
                                className="h-11 rounded-lg"
                                style={{ fontSize: "16px" }}
                                value={targetAudience}
                                onChange={(e) => setTargetAudience(e.target.value)}
                                placeholder="e.g. B2B SaaS founders"
                              />
                            </div>
                            <div>
                              <label className="text-sm font-medium block mb-2">Brand tone</label>
                              <Input
                                className="h-11 rounded-lg"
                                style={{ fontSize: "16px" }}
                                value={tone}
                                onChange={(e) => setTone(e.target.value)}
                                placeholder="e.g. bold, direct"
                              />
                            </div>
                          </div>

                          {primaryColor && (
                            <div className="flex items-center gap-3 pt-1">
                              <div
                                className="h-9 w-9 rounded-lg border shrink-0"
                                style={{ backgroundColor: primaryColor }}
                              />
                              <p className="text-sm text-muted-foreground">
                                Brand colour detected:{" "}
                                <span className="font-mono text-foreground">{primaryColor}</span>
                              </p>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </div>

                    <button
                      className="text-sm text-primary hover:underline block mx-auto"
                      onClick={() => setManualEntry(true)}
                    >
                      Don&apos;t have a website? Enter manually →
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border p-5 sm:p-6 space-y-4">
                    <div>
                      <label className="text-sm font-medium block mb-2">Product name</label>
                      <Input
                        className="h-12 rounded-lg"
                        style={{ fontSize: "16px" }}
                        placeholder="e.g. Acme CRM"
                        value={productName}
                        onChange={(e) => setProductName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium block mb-2">What does it do?</label>
                      <textarea
                        className="w-full rounded-lg border bg-background px-3 py-3 text-base min-h-[108px] resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 leading-relaxed"
                        style={{ fontSize: "16px" }}
                        placeholder="Describe your product and who it's for..."
                        value={productDesc}
                        onChange={(e) => setProductDesc(e.target.value)}
                      />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium block mb-2">Target audience</label>
                        <Input
                          className="h-11 rounded-lg"
                          style={{ fontSize: "16px" }}
                          placeholder="e.g. B2B SaaS founders"
                          value={targetAudience}
                          onChange={(e) => setTargetAudience(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium block mb-2">Brand tone</label>
                        <Input
                          className="h-11 rounded-lg"
                          style={{ fontSize: "16px" }}
                          placeholder="e.g. bold, direct"
                          value={tone}
                          onChange={(e) => setTone(e.target.value)}
                        />
                      </div>
                    </div>
                    <button
                      className="text-sm text-primary hover:underline"
                      onClick={() => setManualEntry(false)}
                    >
                      ← Scan a URL instead
                    </button>
                  </div>
                )}

                <div className="mt-8 flex flex-col gap-3">
                  <Button
                    size="lg"
                    className="w-full h-12 rounded-xl text-base"
                    onClick={() => setStep(5)}
                    disabled={!productName.trim() || !productDesc.trim()}
                  >
                    Continue
                  </Button>
                  <button
                    className="text-sm text-muted-foreground hover:text-foreground transition text-center"
                    onClick={() => setStep(3)}
                  >
                    ← Back
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Step 5: Connect socials ─────────────────────────────────── */}
            {step === 5 && (
              <motion.div
                key="socials"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.32, ease }}
              >
                <div className="mb-10 sm:mb-12">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-4">
                    Connect your accounts
                  </p>
                  <h2 className="text-3xl sm:text-4xl font-normal tracking-tight font-display leading-tight">
                    Add your social accounts
                  </h2>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                    Connect the platforms you want to post to. You can always add or change this from your settings later.
                  </p>
                </div>

                <div className="space-y-3">
                  {SOCIAL_PROVIDERS.map((provider, i) => {
                    const isConnected = connected[provider.id];
                    const isConnecting = connectingProvider === provider.id;
                    return (
                      <motion.div
                        key={provider.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.07, duration: 0.3, ease }}
                        className={cn(
                          "rounded-xl border p-5 flex items-center justify-between gap-5 transition-all",
                          isConnected ? "border-primary bg-primary/3" : "border-border"
                        )}
                      >
                        <div className="min-w-0">
                          <p className="text-base font-medium">{provider.label}</p>
                          <p className="text-sm text-muted-foreground mt-0.5 leading-snug">
                            {provider.description}
                          </p>
                          <p className="text-xs text-muted-foreground/70 mt-0.5">{provider.note}</p>
                        </div>
                        {isConnected ? (
                          <span className="text-sm font-medium text-emerald-600 shrink-0">
                            Connected
                          </span>
                        ) : (
                          <Button
                            variant="outline"
                            className="rounded-lg text-sm h-10 px-5 shrink-0"
                            onClick={() => connectSocial(provider.id)}
                            disabled={isConnecting}
                          >
                            {isConnecting ? "Redirecting…" : "Connect"}
                          </Button>
                        )}
                      </motion.div>
                    );
                  })}

                  <p className="text-sm text-muted-foreground px-1 pt-1">
                    TikTok and LinkedIn can be connected per-product from your dashboard.
                  </p>
                </div>

                <div className="mt-8 flex flex-col gap-3">
                  <Button
                    size="lg"
                    className="w-full h-12 rounded-xl text-base"
                    onClick={generatePreview}
                  >
                    {Object.keys(connected).length > 0
                      ? "Generate my first post"
                      : "Skip and generate my first post"}
                  </Button>
                  <button
                    className="text-sm text-muted-foreground hover:text-foreground transition text-center"
                    onClick={() => setStep(4)}
                  >
                    ← Back
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Step 6: Generating ──────────────────────────────────────── */}
            {step === 6 && (
              <motion.div
                key="generating"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="flex flex-col items-center text-center py-24">
                  <motion.div
                    className="flex gap-2 mb-10"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                  >
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        className="h-3 w-3 rounded-full bg-primary"
                        animate={{ y: [0, -10, 0], opacity: [0.5, 1, 0.5] }}
                        transition={{
                          repeat: Infinity,
                          duration: 1.2,
                          delay: i * 0.2,
                          ease: "easeInOut",
                        }}
                      />
                    ))}
                  </motion.div>
                  <h2 className="text-2xl sm:text-3xl font-normal font-display mb-4">
                    Creating your first post
                  </h2>
                  <p className="text-base text-muted-foreground max-w-sm leading-relaxed">
                    Reading your product, understanding your brand, and writing content tailored to your audience.
                  </p>
                  <p className="mt-8 text-sm text-muted-foreground">
                    This takes about 10 seconds
                  </p>
                </div>
              </motion.div>
            )}

            {/* ── Step 7: Paywall ─────────────────────────────────────────── */}
            {step === 7 && (
              <motion.div
                key="paywall"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.35, ease }}
              >
                <div className="mb-8">
                  <motion.div
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 280, delay: 0.1 }}
                    className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 mb-6"
                  >
                    <span className="text-emerald-600 font-bold text-base">✓</span>
                  </motion.div>
                  <h2 className="text-3xl sm:text-4xl font-normal tracking-tight font-display leading-tight">
                    Your first post is ready
                  </h2>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                    Start your {TRIAL_DAYS}-day free trial to publish it — and everything else you create.
                  </p>
                </div>

                {/* Post preview */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15, duration: 0.35 }}
                >
                  {postContent ? (
                    <PostPreviewCard
                      content={postContent}
                      productName={productName}
                      primaryColor={primaryColor}
                      locked
                    />
                  ) : (
                    <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-10 text-center text-base text-muted-foreground">
                      Your first post is ready inside your dashboard.
                    </div>
                  )}
                </motion.div>

                {/* Plan selection */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25, duration: 0.35 }}
                  className="mt-10"
                >
                  <div className="flex items-baseline justify-between mb-5">
                    <p className="text-base font-semibold">Recommended for you</p>
                    <span className="text-sm text-muted-foreground">Based on your answers</span>
                  </div>

                  {/* Interval toggle */}
                  <div className="flex justify-center mb-6">
                    <div className="inline-flex items-center rounded-xl border overflow-hidden">
                      {(["monthly", "annual"] as BillingInterval[]).map((iv) => (
                        <button
                          key={iv}
                          className={cn(
                            "px-6 py-2.5 text-sm font-medium transition-all",
                            interval === iv
                              ? "bg-primary text-white"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                          )}
                          onClick={() => setInterval(iv)}
                        >
                          {iv === "monthly" ? "Monthly" : "Annual — save 17%"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Plan cards */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(["starter", "pro", "business"] as PlanTier[]).map((tierKey) => {
                      const plan = PLANS[tierKey];
                      const price = interval === "annual" ? plan.price.annual : plan.price.monthly;
                      const isSelected = selectedTier === tierKey;
                      return (
                        <button
                          key={tierKey}
                          className={cn(
                            "rounded-xl border p-5 text-left transition-all relative active:scale-[0.99]",
                            isSelected
                              ? "border-primary bg-primary/3 shadow-sm"
                              : "border-border/60 hover:border-foreground/30"
                          )}
                          onClick={() => setSelectedTier(tierKey)}
                        >
                          {plan.badge && isSelected && (
                            <span className="absolute -top-2.5 left-3 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold text-white uppercase tracking-wide">
                              {plan.badge}
                            </span>
                          )}
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-sm font-semibold text-foreground">{plan.name}</p>
                            {isSelected && (
                              <span className="text-[10px] font-bold text-primary uppercase tracking-wide">
                                Selected
                              </span>
                            )}
                          </div>
                          <p className="text-2xl font-bold text-foreground">${price}</p>
                          <p className="text-xs text-muted-foreground">/month</p>
                          {interval === "annual" && (
                            <p className="text-xs text-muted-foreground mt-1 line-through">
                              ${plan.price.monthly}/mo
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Trial messaging — both intervals now have trial */}
                  <p className="text-center text-sm font-medium mt-4 text-emerald-600">
                    {TRIAL_DAYS}-day free trial on all plans · No charge until day {TRIAL_DAYS + 1}
                  </p>
                  {interval === "annual" && (
                    <p className="text-center text-xs text-muted-foreground mt-1">
                      Annual billing saves you 17% compared to monthly
                    </p>
                  )}

                  <Button
                    size="lg"
                    className="w-full mt-6 h-13 rounded-xl text-base"
                    onClick={handleCheckout}
                    disabled={busy}
                  >
                    {busy
                      ? "Setting up…"
                      : `Start ${TRIAL_DAYS}-Day Free Trial — ${PLANS[selectedTier].name}`}
                  </Button>
                  <p className="text-center text-sm text-muted-foreground mt-3">
                    Card required · Cancel anytime before the trial ends
                  </p>
                </motion.div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </main>

      {/* ── Footer — matches MarketingLayout exactly ──────────────────────── */}
      <OnboardingFooter />
    </div>
  );
}
