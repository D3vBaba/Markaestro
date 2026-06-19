"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth, friendlyAuthError } from "@/components/providers/AuthProvider";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-client";
import { useProductScan } from "@/hooks/useProductScan";
import ScanProgressStepper from "@/components/app/ScanProgressStepper";
import { PLANS, TRIAL_DAYS } from "@/lib/stripe/plans";
import type { PlanTier, BillingInterval } from "@/lib/stripe/plans";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

// ─── Quiz data ────────────────────────────────────────────────────────────────
// Ten questions asked BEFORE registration. They personalise the recommended plan
// and the value framing on the paywall, and build investment so the user is more
// likely to register and start a trial.

type QuizOption = { id: string; label: string; desc?: string };
type QuizQuestion = {
  id: string;
  type: "single" | "multi";
  eyebrow: string;
  title: string;
  subtitle?: string;
  options: QuizOption[];
  columns?: boolean; // render options in two columns
};

const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: "role",
    type: "single",
    eyebrow: "Let's build your engine",
    title: "What's your role?",
    subtitle: "We'll tailor everything to how you actually work.",
    options: [
      { id: "founder", label: "Founder / CEO", desc: "Wearing every hat — including marketing" },
      { id: "marketer", label: "Marketer", desc: "Owning content across every channel" },
      { id: "agency", label: "Agency / Freelancer", desc: "Juggling posts for multiple clients" },
      { id: "creator", label: "Content Creator", desc: "Growing an audience that's all you" },
    ],
  },
  {
    id: "teamSize",
    type: "single",
    eyebrow: "Your team",
    title: "Who's behind the posting?",
    options: [
      { id: "solo", label: "Just me", desc: "And honestly, it's a lot" },
      { id: "small", label: "2–5 people", desc: "Small team, many hats" },
      { id: "medium", label: "6–20 people", desc: "Coordination is getting messy" },
      { id: "large", label: "20+ people", desc: "Keeping everyone consistent is hard" },
    ],
  },
  {
    id: "goal",
    type: "single",
    eyebrow: "The mission",
    title: "What are you really after?",
    subtitle: "It shapes your setup and the plan we recommend.",
    options: [
      { id: "social", label: "Grow my following", desc: "More reach, more engagement" },
      { id: "sales", label: "Drive more sales", desc: "Turn posts into pipeline" },
      { id: "time", label: "Win back my time", desc: "Stop drowning in content" },
    ],
  },
  {
    id: "channels",
    type: "multi",
    eyebrow: "Your stage",
    title: "Where does your audience live?",
    subtitle: "Pick all that apply — you'll publish to each in one click.",
    columns: true,
    options: [
      { id: "instagram", label: "Instagram" },
      { id: "facebook", label: "Facebook" },
      { id: "tiktok", label: "TikTok" },
      { id: "threads", label: "Threads" },
      { id: "pinterest", label: "Pinterest" },
    ],
  },
  {
    id: "postingToday",
    type: "single",
    eyebrow: "Be honest",
    title: "How are you posting today?",
    subtitle: "Most teams tell us this is the painful part.",
    options: [
      { id: "manual", label: "Manually in each app", desc: "Logging in everywhere, one by one" },
      { id: "spreadsheet", label: "Spreadsheets & reminders", desc: "Sticky notes and hope" },
      { id: "tool", label: "Another scheduling tool", desc: "One I've quietly outgrown" },
      { id: "starting", label: "Barely posting at all", desc: "No real system yet" },
    ],
  },
  {
    id: "frequency",
    type: "single",
    eyebrow: "The cadence you want",
    title: "How often do you want to show up?",
    subtitle: "We'll keep you on schedule automatically.",
    options: [
      { id: "daily", label: "Every day", desc: "Stay top of mind" },
      { id: "few", label: "A few times a week", desc: "Steady wins the race" },
      { id: "weekly", label: "About once a week", desc: "Quality over noise" },
      { id: "unsure", label: "Not sure yet", desc: "Tell me what actually works" },
    ],
  },
  {
    id: "challenge",
    type: "single",
    eyebrow: "The real problem",
    title: "What keeps tripping you up?",
    subtitle: "This is the thing we're going to fix for you.",
    options: [
      { id: "consistency", label: "Staying consistent", desc: "I start strong, then go quiet" },
      { id: "time", label: "Finding the time", desc: "There's never enough of it" },
      { id: "ideas", label: "Coming up with content", desc: "I keep running dry on ideas" },
      { id: "juggling", label: "Juggling channels", desc: "Too many platforms to keep up with" },
    ],
  },
  {
    id: "contentTypes",
    type: "multi",
    eyebrow: "Your voice",
    title: "What do you want to post?",
    subtitle: "Pick all that apply — we'll help you fill the calendar.",
    columns: true,
    options: [
      { id: "product", label: "Product & promotions" },
      { id: "educational", label: "Tips & education" },
      { id: "bts", label: "Behind the scenes" },
      { id: "news", label: "News & updates" },
    ],
  },
  {
    id: "hoursPerWeek",
    type: "single",
    eyebrow: "The hidden cost",
    title: "How many hours a week vanish into this?",
    subtitle: "Be honest — it's almost always more than it feels.",
    options: [
      { id: "lt2", label: "Under 2 hours" },
      { id: "2to5", label: "2–5 hours" },
      { id: "5to10", label: "5–10 hours" },
      { id: "gt10", label: "10+ hours" },
    ],
  },
  {
    id: "success",
    type: "single",
    eyebrow: "90 days from now",
    title: "What would make this worth it?",
    subtitle: "We'll point your whole setup at this outcome.",
    options: [
      { id: "followers", label: "A bigger, engaged audience", desc: "Reach that compounds" },
      { id: "sales", label: "Content that drives revenue", desc: "Posts that actually convert" },
      { id: "timeback", label: "My evenings & weekends back", desc: "Hours returned every week" },
      { id: "consistency", label: "Never going quiet again", desc: "A presence I can rely on" },
    ],
  },
];

// ─── Pain → payoff mapping ─────────────────────────────────────────────────────
// Carries the user's stated challenge into the generating screen and paywall so
// the close speaks directly to the problem they just told us about.

const CHALLENGE_COPY: Record<string, { short: string; headline: string; line: string }> = {
  consistency: {
    short: "staying consistent",
    headline: "You'll never go quiet again",
    line: "Schedule weeks of posts in one sitting — Markaestro publishes on time, every time, so the silence stops.",
  },
  time: {
    short: "finding the time",
    headline: "Let's win those hours back",
    line: "Write once, publish everywhere, and schedule ahead. The copy-paste-and-log-in busywork simply disappears.",
  },
  ideas: {
    short: "coming up with content",
    headline: "Your calendar won't run dry",
    line: "Turn one idea into a week of posts across every channel — so you're never staring at a blank screen.",
  },
  juggling: {
    short: "juggling channels",
    headline: "One place for every channel",
    line: "Compose once and publish to all your platforms from a single screen — no more tab-juggling or dropped posts.",
  },
};

function challengeCopy(answers: Answers) {
  const key = (answers.challenge as string) || "time";
  return CHALLENGE_COPY[key] ?? CHALLENGE_COPY.time;
}

const SOCIAL_PROVIDERS = [
  {
    id: "meta",
    label: "Meta",
    description: "Connect Facebook and Instagram",
    note: "Pages, Reels, Feed posts, Stories",
  },
];

// ─── Step indices ─────────────────────────────────────────────────────────────
// 0..9   = the ten quiz questions
// 10     = register (skipped when already signed in)
// 11     = add an app (scan / manual / skip)
// 12     = connect socials
// 13     = generating (transient loader)
// 14     = paywall

const QUIZ_COUNT = QUIZ_QUESTIONS.length;
const REGISTER_STEP = QUIZ_COUNT; // 10
const PRODUCT_STEP = QUIZ_COUNT + 1; // 11
const SOCIALS_STEP = QUIZ_COUNT + 2; // 12
const GENERATING_STEP = QUIZ_COUNT + 3; // 13
const PAYWALL_STEP = QUIZ_COUNT + 4; // 14

// Ordered list of user-facing screens (the transient generating loader excluded)
// used to drive the progress bar.
const FLOW_STEPS = [
  ...QUIZ_QUESTIONS.map((_, i) => i),
  REGISTER_STEP,
  PRODUCT_STEP,
  SOCIALS_STEP,
  PAYWALL_STEP,
];

// ─── Plan recommender ─────────────────────────────────────────────────────────

function recommendPlan(role: string, teamSize: string): PlanTier {
  if (role === "agency" || teamSize === "large" || teamSize === "medium") return "business";
  if (teamSize === "small" || role === "marketer") return "pro";
  return "starter";
}

// Estimated hours Markaestro can save per week, keyed off the time-spent answer.
const HOURS_SAVED: Record<string, number> = { lt2: 3, "2to5": 6, "5to10": 9, gt10: 14 };

// ─── Persisted state ──────────────────────────────────────────────────────────

const STORAGE_KEY = "onboarding_state_v3";

type Answers = Record<string, string | string[]>;

type PersistedState = {
  step: number;
  answers: Answers;
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
  productId: string;
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

function ProgressBar({ step }: { step: number }) {
  if (step === GENERATING_STEP) return null;
  const idx = FLOW_STEPS.indexOf(step);
  const pct = idx === -1 ? 0 : Math.round(((idx + 1) / FLOW_STEPS.length) * 100);
  return (
    <div className="h-px w-full" style={{ background: "var(--mk-rule)" }}>
      <motion.div
        className="h-full"
        style={{ background: "var(--mk-accent)" }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.4, ease }}
      />
    </div>
  );
}

// ─── Auto-detected badge ──────────────────────────────────────────────────────

function AutoDetectedBadge() {
  return (
    <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary align-middle">
      Auto-detected
    </span>
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
      className="w-full rounded-xl p-4 sm:p-5 text-left transition-colors duration-150 min-h-[72px] active:scale-[0.99]"
      style={{
        background: selected ? "var(--mk-panel)" : "var(--mk-paper)",
        border: `1px solid ${selected ? "var(--mk-ink)" : "var(--mk-rule)"}`,
      }}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p
            className="text-[15px] font-medium leading-snug"
            style={{ color: "var(--mk-ink)", letterSpacing: "-0.01em" }}
          >
            {label}
          </p>
          {desc && (
            <p
              className="text-[13px] mt-0.5 leading-relaxed"
              style={{ color: "var(--mk-ink-60)" }}
            >
              {desc}
            </p>
          )}
        </div>
        <div
          className={cn(
            "shrink-0 transition-all h-5 w-5 flex items-center justify-center",
            multi ? "rounded" : "rounded-full",
          )}
          style={{
            border: `1.5px solid ${selected ? "var(--mk-ink)" : "var(--mk-ink-20)"}`,
            background: multi && selected ? "var(--mk-ink)" : "transparent",
          }}
        >
          {multi && selected && (
            <span
              className="text-[10px] font-bold leading-none"
              style={{ color: "var(--mk-paper)" }}
            >
              ✓
            </span>
          )}
          {!multi && selected && (
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: "var(--mk-ink)" }}
            />
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
              <Link href="/onboarding" className="text-sm text-muted-foreground hover:text-foreground transition">Create Account</Link>
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
  const {
    user,
    loading: authLoading,
    logout,
    signInEmail,
    signUpEmail,
    signInGoogle,
    signInFacebook,
  } = useAuth();
  const { status: subStatus, loading: subLoading } = useSubscription();
  const router = useRouter();

  const saved = loadState();

  const [step, setStep] = useState(saved.step ?? 0);
  const [answers, setAnswers] = useState<Answers>(saved.answers ?? {});

  // Product
  const [productMode, setProductMode] = useState<"scan" | "manual">("scan");
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
  const [productId, setProductId] = useState(saved.productId ?? "");
  const { phase: scanPhase, scanning, scanned: scanDone, scan: runScan, reset: resetScan } = useProductScan();
  const [autoFilled, setAutoFilled] = useState<Record<string, boolean>>({});

  // Socials
  const [connected, setConnected] = useState<Record<string, boolean>>(saved.connected ?? {});
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);

  const [postContent] = useState("");

  // Plan
  const [selectedTier, setSelectedTier] = useState<PlanTier>(saved.selectedTier ?? "pro");
  const [interval, setInterval] = useState<BillingInterval>(saved.interval ?? "annual");
  const [busy, setBusy] = useState(false);

  // Register
  const [regMode, setRegMode] = useState<"signup" | "signin">("signup");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regError, setRegError] = useState("");
  const [regBusy, setRegBusy] = useState(false);

  // Skips the leave-protection prompt for intentional redirects (OAuth, checkout).
  const skipLeaveGuardRef = useRef(false);

  // ─── Persist state ──────────────────────────────────────────────────────────

  useEffect(() => {
    const snapshot: PersistedState = {
      step, answers,
      productUrl, productName, productDesc, productCategory, productPricingTier, productTags,
      primaryColor, secondaryColor, accentColor, logoUrl, tone, targetAudience, productId,
      selectedTier, interval, connected,
    };
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* ignore */ }
  }, [
    step, answers,
    productUrl, productName, productDesc, productCategory, productPricingTier, productTags,
    primaryColor, secondaryColor, accentColor, logoUrl, tone, targetAudience, productId,
    selectedTier, interval, connected,
  ]);

  // ─── Guards ───────────────────────────────────────────────────────────────
  // The quiz is public — no auth required. Only a user who already has an active
  // subscription is sent away (they've finished onboarding).

  useEffect(() => {
    if (authLoading || subLoading) return;
    if (user && subStatus?.active) router.replace("/dashboard");
  }, [authLoading, subLoading, user, subStatus, router]);

  // Once registration succeeds, advance into the setup phase. Also covers a
  // signed-in-but-not-subscribed user who reaches the register step.
  useEffect(() => {
    if (user && step === REGISTER_STEP) {
      setRegBusy(false);
      setStep(PRODUCT_STEP);
    }
  }, [user, step]);

  // ─── OAuth return ───────────────────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("oauth");
    const oauthProvider = params.get("provider");
    const oauthProductId = params.get("productId");
    if (oauthResult && oauthProvider) {
      if (oauthProductId) {
        setProductId(oauthProductId);
      }
      if (oauthResult === "success") {
        setConnected((prev) => ({ ...prev, [oauthProvider]: true }));
        const label = oauthProvider === "meta" ? "Meta (Facebook + Instagram)" : oauthProvider;
        toast.success(`${label} connected`);
      } else {
        toast.error(`Failed to connect ${oauthProvider}`);
      }
      window.history.replaceState({}, "", "/onboarding");
    }
  }, []);

  // ─── Generating → paywall ─────────────────────────────────────────────────

  useEffect(() => {
    if (step !== GENERATING_STEP) return;
    const t = setTimeout(() => setStep(PAYWALL_STEP), 2200);
    return () => clearTimeout(t);
  }, [step]);

  // ─── Leave protection ───────────────────────────────────────────────────────
  // Warn before leaving mid-flow (after the first answer, up to the socials step,
  // which is the last screen before the generating loader and the paywall).

  useEffect(() => {
    if (step < 1 || step > SOCIALS_STEP) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (skipLeaveGuardRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [step]);

  // ─── Auto-recommend plan ─────────────────────────────────────────────────────

  useEffect(() => {
    const role = (answers.role as string) || "";
    const teamSize = (answers.teamSize as string) || "";
    if (role && teamSize) setSelectedTier(recommendPlan(role, teamSize));
  }, [answers.role, answers.teamSize]);

  if (authLoading || (user && subLoading)) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="h-8 w-8 rounded-lg bg-primary animate-pulse" />
      </div>
    );
  }

  if (user && subStatus?.active) return null;

  const trialEndLabel = new Date(
    Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
  ).toLocaleDateString("en-US", { month: "long", day: "numeric" });

  const hoursSaved = HOURS_SAVED[(answers.hoursPerWeek as string)] ?? 6;
  const channelCount = Array.isArray(answers.channels) ? (answers.channels as string[]).length : 0;
  const frequencyLabel =
    QUIZ_QUESTIONS.find((q) => q.id === "frequency")
      ?.options.find((o) => o.id === answers.frequency)
      ?.label.toLowerCase() ?? "on a steady cadence";
  const challenge = challengeCopy(answers);

  // ─── Quiz helpers ─────────────────────────────────────────────────────────

  function answerSingle(questionId: string, optionId: string, nextStep: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    setTimeout(() => setStep(nextStep), 200);
  }

  function toggleMulti(questionId: string, optionId: string) {
    setAnswers((prev) => {
      const current = Array.isArray(prev[questionId]) ? (prev[questionId] as string[]) : [];
      const next = current.includes(optionId)
        ? current.filter((c) => c !== optionId)
        : [...current, optionId];
      return { ...prev, [questionId]: next };
    });
  }

  // ─── Product handlers ───────────────────────────────────────────────────────

  async function scanUrl() {
    let url = productUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    setProductUrl(url);

    const d = await runScan(url);
    if (d) {
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
      setAutoFilled({
        name: !!d.name,
        description: !!d.description,
        targetAudience: !!d.targetAudience,
        tone: !!d.tone,
      });
    } else {
      setProductMode("manual");
    }
  }

  async function ensureOnboardingProduct() {
    if (productId) return productId;

    const normalizedUrl = productUrl.trim()
      ? (/^https?:\/\//i.test(productUrl.trim()) ? productUrl.trim() : `https://${productUrl.trim()}`)
      : "";
    const res = await apiFetch<{ id: string }>("/api/products", {
      method: "POST",
      body: JSON.stringify({
        name: productName.trim() || "My product",
        description: productDesc.trim(),
        url: normalizedUrl,
        categories: [productCategory || "saas"],
        status: "active",
        brandVoice: {
          tone: tone.trim(),
          targetAudience: targetAudience.trim(),
        },
        brandIdentity: {
          logoUrl,
          primaryColor,
          secondaryColor,
          accentColor,
        },
      }),
    });

    if (!res.ok || !res.data.id) {
      throw new Error("PRODUCT_CREATE_FAILED");
    }

    setProductId(res.data.id);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...loadState(),
        productId: res.data.id,
      }));
    } catch {
      // The OAuth callback also carries productId; session storage is only a resilience layer.
    }
    return res.data.id;
  }

  // Continue out of the product step. Creates the product when the user supplied
  // details; otherwise advances straight on (the step is fully skippable).
  async function handleProductContinue() {
    if (!productName.trim()) {
      setStep(SOCIALS_STEP);
      return;
    }
    setBusy(true);
    try {
      await ensureOnboardingProduct();
    } catch {
      toast.error("Couldn't save your product — you can add it later from the dashboard.");
    } finally {
      setBusy(false);
      setStep(SOCIALS_STEP);
    }
  }

  async function connectSocial(providerId: string) {
    setConnectingProvider(providerId);
    try {
      const ensuredProductId = await ensureOnboardingProduct();
      const returnTo = "/onboarding";
      const qs = new URLSearchParams({
        workspaceId: "default",
        productId: ensuredProductId,
        returnTo,
      });
      skipLeaveGuardRef.current = true;
      window.location.href = `/api/oauth/authorize/${providerId}?${qs.toString()}`;
    } catch {
      toast.error("Could not initiate connection. Please try again.");
    } finally {
      setConnectingProvider(null);
    }
  }

  // ─── Register handlers ──────────────────────────────────────────────────────

  async function handleRegister() {
    if (!regEmail.trim() || !regPassword) {
      setRegError("Enter your email and a password to continue.");
      return;
    }
    setRegError("");
    setRegBusy(true);
    try {
      if (regMode === "signup") {
        await signUpEmail(regEmail.trim(), regPassword);
      } else {
        await signInEmail(regEmail.trim(), regPassword);
      }
      // onAuthStateChanged sets the user; the guard effect advances the step.
      // Keep regBusy true so the button stays in its loading state until then.
    } catch (e: unknown) {
      setRegError(friendlyAuthError(e));
      setRegBusy(false);
    }
  }

  async function handleSocialRegister(provider: "google" | "facebook") {
    setRegError("");
    setRegBusy(true);
    try {
      if (provider === "google") await signInGoogle();
      else await signInFacebook();
    } catch (e: unknown) {
      setRegError(friendlyAuthError(e));
      setRegBusy(false);
    }
  }

  function handleCheckout() {
    setBusy(true);
    apiFetch<{ url: string }>("/api/stripe/checkout", {
      method: "POST",
      body: JSON.stringify({ tier: selectedTier, interval }),
    })
      .then((res) => {
        if (res.ok && res.data.url) {
          skipLeaveGuardRef.current = true;
          window.location.href = res.data.url;
        } else {
          setBusy(false);
        }
      })
      .catch(() => setBusy(false));
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  const currentQuestion = step < QUIZ_COUNT ? QUIZ_QUESTIONS[step] : null;

  return (
    <div className="min-h-screen flex flex-col bg-background">

      {/* ── Header — minimal onboarding chrome ──────────────────────────── */}
      <header
        className="sticky top-0 z-50 border-b backdrop-blur-md"
        style={{
          background: "color-mix(in oklch, var(--mk-paper) 92%, transparent)",
          borderColor: "var(--mk-rule)",
        }}
      >
        <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center justify-between px-5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/markaestro-logo-transparent.png"
              alt="Markaestro"
              width={28}
              height={28}
              className="object-contain"
            />
            <span
              className="text-[15px] font-semibold tracking-tight"
              style={{ color: "var(--mk-ink)", letterSpacing: "-0.015em" }}
            >
              Markaestro
            </span>
          </Link>

          <div className="flex items-center gap-4">
            {step < QUIZ_COUNT && (
              <span
                className="hidden sm:inline font-mono text-[10.5px] uppercase tabular-nums"
                style={{ color: "var(--mk-ink-40)", letterSpacing: "0.14em" }}
              >
                Question {step + 1} / {QUIZ_COUNT}
              </span>
            )}
            {user ? (
              <button
                className="text-[12.5px] transition-colors"
                style={{ color: "var(--mk-ink-60)" }}
                onClick={logout}
              >
                Sign out
              </button>
            ) : (
              <Link
                href="/login"
                className="text-[12.5px] transition-colors"
                style={{ color: "var(--mk-ink-60)" }}
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
        <ProgressBar step={step} />
      </header>

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <main className="flex-1 w-full">
        <div className="mx-auto max-w-2xl px-5 sm:px-8 py-12 sm:py-16">
          <AnimatePresence mode="wait">

            {/* ── Quiz questions (data-driven) ────────────────────────────── */}
            {currentQuestion && (
              <motion.div
                key={`q-${currentQuestion.id}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.32, ease }}
              >
                <div className="mb-10 sm:mb-12">
                  <p className="mk-eyebrow mb-4">{currentQuestion.eyebrow}</p>
                  <h1 className="text-[28px] sm:text-[34px] font-semibold leading-[1.1] tracking-[-0.03em]">
                    {currentQuestion.title}
                  </h1>
                  {currentQuestion.subtitle && (
                    <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                      {currentQuestion.subtitle}
                    </p>
                  )}
                  {step === 0 && (
                    <div
                      className="mt-5 inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[10px] uppercase"
                      style={{
                        border: "1px solid color-mix(in oklch, var(--mk-accent) 24%, var(--mk-rule))",
                        background: "var(--mk-accent-soft)",
                        color: "var(--mk-accent)",
                        letterSpacing: "0.12em",
                      }}
                    >
                      Takes 2 minutes · No card required
                    </div>
                  )}
                </div>

                <div className={cn("grid gap-3", currentQuestion.columns && "sm:grid-cols-2")}>
                  {currentQuestion.options.map((opt, i) => {
                    if (currentQuestion.type === "multi") {
                      const sel = Array.isArray(answers[currentQuestion.id])
                        ? (answers[currentQuestion.id] as string[]).includes(opt.id)
                        : false;
                      return (
                        <SelectionTile
                          key={opt.id}
                          multi
                          selected={sel}
                          label={opt.label}
                          desc={opt.desc}
                          delay={i * 0.04}
                          onClick={() => toggleMulti(currentQuestion.id, opt.id)}
                        />
                      );
                    }
                    return (
                      <SelectionTile
                        key={opt.id}
                        selected={answers[currentQuestion.id] === opt.id}
                        label={opt.label}
                        desc={opt.desc}
                        delay={i * 0.05}
                        onClick={() => answerSingle(currentQuestion.id, opt.id, step + 1)}
                      />
                    );
                  })}
                </div>

                {/* Multi-select steps need an explicit advance button. */}
                {currentQuestion.type === "multi" && (
                  <div className="mt-8">
                    <Button
                      size="lg"
                      className="w-full h-12 rounded-xl text-base"
                      onClick={() => setStep(step + 1)}
                    >
                      {Array.isArray(answers[currentQuestion.id]) &&
                      (answers[currentQuestion.id] as string[]).length > 0
                        ? "Continue"
                        : "Skip for now"}
                    </Button>
                  </div>
                )}

                {step > 0 && (
                  <button
                    className="mt-6 text-sm text-muted-foreground hover:text-foreground transition"
                    onClick={() => setStep(step - 1)}
                  >
                    ← Back
                  </button>
                )}
              </motion.div>
            )}

            {/* ── Register ─────────────────────────────────────────────────── */}
            {/* Only shown to logged-out visitors; a signed-in user is advanced
                past this step by the guard effect, so we never flash the form. */}
            {step === REGISTER_STEP && !user && (
              <motion.div
                key="register"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.32, ease }}
              >
                <div className="mb-8">
                  <p className="mk-eyebrow mb-4">Your plan is ready</p>
                  <h2 className="text-[28px] sm:text-[34px] font-semibold leading-[1.1] tracking-[-0.03em]">
                    {regMode === "signup"
                      ? "Save your plan & claim your time back"
                      : "Welcome back"}
                  </h2>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                    {regMode === "signup"
                      ? "Create your free account to lock in the workflow we just built — no card required to keep going."
                      : "Sign in to pick up right where you left off."}
                  </p>
                </div>

                {/* Personalised recap — shows what they built so registering
                    feels like claiming it back, not filling out a form. */}
                {regMode === "signup" && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease }}
                    className="mb-6 rounded-xl border p-5"
                    style={{ background: "var(--mk-panel)", borderColor: "var(--mk-rule)" }}
                  >
                    <p className="mk-eyebrow mb-3">Waiting in your workspace</p>
                    <div className="flex flex-col gap-2.5">
                      {[
                        channelCount > 0
                          ? `${channelCount} channel${channelCount > 1 ? "s" : ""} ready to publish in one click`
                          : "Every channel, published from one place",
                        `Posts scheduled ${frequencyLabel} — automatically`,
                        `~${hoursSaved} hours a week back in your calendar`,
                        challenge.headline,
                      ].map((item) => (
                        <div key={item} className="flex items-start gap-2.5">
                          <span
                            className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0"
                            style={{ background: "var(--mk-accent)" }}
                          />
                          <p className="text-[14px] leading-snug" style={{ color: "var(--mk-ink-80)" }}>
                            {item}
                          </p>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                <div className="rounded-xl border p-5 sm:p-6">
                  <div
                    className="grid grid-cols-2 gap-1 rounded-lg p-1 mb-5"
                    style={{ background: "var(--mk-panel)", border: "1px solid var(--mk-rule)" }}
                  >
                    {(["signup", "signin"] as const).map((m) => (
                      <button
                        key={m}
                        className="h-8 rounded-[6px] text-[12.5px] font-medium transition-colors"
                        style={{
                          background: regMode === m ? "var(--mk-paper)" : "transparent",
                          color: regMode === m ? "var(--mk-ink)" : "var(--mk-ink-60)",
                          border: regMode === m ? "1px solid var(--mk-rule)" : "1px solid transparent",
                        }}
                        onClick={() => { setRegMode(m); setRegError(""); }}
                      >
                        {m === "signup" ? "Create account" : "Sign in"}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-col gap-3">
                    <Input
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="name@company.com"
                      type="email"
                      autoComplete="email"
                      className="h-11 rounded-lg"
                      style={{ fontSize: "16px" }}
                      onKeyDown={(e) => e.key === "Enter" && !regBusy && handleRegister()}
                    />
                    <Input
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Password"
                      type="password"
                      autoComplete={regMode === "signup" ? "new-password" : "current-password"}
                      className="h-11 rounded-lg"
                      style={{ fontSize: "16px" }}
                      onKeyDown={(e) => e.key === "Enter" && !regBusy && handleRegister()}
                    />

                    {regError && (
                      <p className="rounded-lg px-3.5 py-2.5 text-[12px] bg-destructive/10 text-destructive">
                        {regError}
                      </p>
                    )}

                    <Button
                      className="h-11 w-full rounded-lg text-[14px]"
                      disabled={regBusy}
                      onClick={handleRegister}
                    >
                      {regBusy
                        ? "Please wait…"
                        : regMode === "signup"
                        ? "Claim my plan — it's free"
                        : "Sign in & continue"}
                    </Button>
                    {regMode === "signup" && (
                      <p className="text-center text-[12px]" style={{ color: "var(--mk-ink-40)" }}>
                        Free to start · 14-day trial · Cancel anytime
                      </p>
                    )}
                  </div>

                  <div className="relative my-5 flex items-center gap-3">
                    <span className="flex-1 h-px" style={{ background: "var(--mk-rule)" }} />
                    <span
                      className="font-mono text-[9.5px] uppercase"
                      style={{ color: "var(--mk-ink-40)", letterSpacing: "0.18em" }}
                    >
                      Or continue with
                    </span>
                    <span className="flex-1 h-px" style={{ background: "var(--mk-rule)" }} />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <Button
                      variant="outline"
                      className="h-11 w-full rounded-lg gap-2 text-[13.5px]"
                      disabled={regBusy}
                      onClick={() => handleSocialRegister("google")}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                      Google
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 w-full rounded-lg gap-2 text-[13.5px]"
                      disabled={regBusy}
                      onClick={() => handleSocialRegister("facebook")}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="var(--mk-ch-facebook)"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                      Facebook
                    </Button>
                  </div>
                </div>

                <p className="mt-5 text-center text-[11.5px]" style={{ color: "var(--mk-ink-40)" }}>
                  By continuing you agree to our{" "}
                  <a href="/terms" className="hover:underline" style={{ color: "var(--mk-ink-60)" }}>Terms</a>{" "}
                  and{" "}
                  <a href="/privacy" className="hover:underline" style={{ color: "var(--mk-ink-60)" }}>Privacy Policy</a>.
                </p>

                <button
                  className="mt-4 text-sm text-muted-foreground hover:text-foreground transition mx-auto block"
                  onClick={() => setStep(QUIZ_COUNT - 1)}
                >
                  ← Back
                </button>
              </motion.div>
            )}

            {/* ── Add an app ───────────────────────────────────────────────── */}
            {step === PRODUCT_STEP && (
              <motion.div
                key="product"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.32, ease }}
              >
                <div className="mb-8">
                  <p className="mk-eyebrow mb-4">Your product</p>
                  <h2 className="text-[28px] sm:text-[34px] font-semibold leading-[1.1] tracking-[-0.03em]">
                    Add the app you&apos;re marketing
                  </h2>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                    Scan your website to auto-fill the details, add it manually, or
                    skip this for now — you can always do it later.
                  </p>
                </div>

                {/* Mode toggle */}
                <div
                  className="grid grid-cols-2 gap-1 rounded-lg p-1 mb-6"
                  style={{ background: "var(--mk-panel)", border: "1px solid var(--mk-rule)" }}
                >
                  {(["scan", "manual"] as const).map((m) => (
                    <button
                      key={m}
                      className="h-9 rounded-[6px] text-[13px] font-medium transition-colors"
                      style={{
                        background: productMode === m ? "var(--mk-paper)" : "transparent",
                        color: productMode === m ? "var(--mk-ink)" : "var(--mk-ink-60)",
                        border: productMode === m ? "1px solid var(--mk-rule)" : "1px solid transparent",
                      }}
                      onClick={() => setProductMode(m)}
                    >
                      {m === "scan" ? "Scan a website" : "Enter manually"}
                    </button>
                  ))}
                </div>

                {productMode === "scan" ? (
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
                          onChange={(e) => { setProductUrl(e.target.value); if (scanDone) { resetScan(); setAutoFilled({}); } }}
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

                    <ScanProgressStepper phase={scanPhase} url={productUrl} />

                    {scanDone && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-4 pt-5 border-t"
                      >
                        <div>
                          <label className="text-sm font-medium block mb-2">
                            Product name
                            {autoFilled.name && <AutoDetectedBadge />}
                          </label>
                          <Input
                            className="h-11 rounded-lg"
                            style={{ fontSize: "16px" }}
                            value={productName}
                            onChange={(e) => { setProductName(e.target.value); setAutoFilled((p) => ({ ...p, name: false })); }}
                          />
                        </div>

                        <div>
                          <label className="text-sm font-medium block mb-2">
                            Description
                            {autoFilled.description && <AutoDetectedBadge />}
                          </label>
                          <textarea
                            className="w-full rounded-lg border bg-background px-3 py-3 text-base min-h-[96px] resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 leading-relaxed"
                            style={{ fontSize: "16px" }}
                            value={productDesc}
                            onChange={(e) => { setProductDesc(e.target.value); setAutoFilled((p) => ({ ...p, description: false })); }}
                          />
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">
                          <div>
                            <label className="text-sm font-medium block mb-2">
                              Target audience
                              {autoFilled.targetAudience && <AutoDetectedBadge />}
                            </label>
                            <Input
                              className="h-11 rounded-lg"
                              style={{ fontSize: "16px" }}
                              value={targetAudience}
                              onChange={(e) => { setTargetAudience(e.target.value); setAutoFilled((p) => ({ ...p, targetAudience: false })); }}
                              placeholder="e.g. B2B SaaS founders"
                            />
                          </div>
                          <div>
                            <label className="text-sm font-medium block mb-2">
                              Brand tone
                              {autoFilled.tone && <AutoDetectedBadge />}
                            </label>
                            <Input
                              className="h-11 rounded-lg"
                              style={{ fontSize: "16px" }}
                              value={tone}
                              onChange={(e) => { setTone(e.target.value); setAutoFilled((p) => ({ ...p, tone: false })); }}
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
                      <label className="text-sm font-medium block mb-2">
                        What does it do? <span className="text-muted-foreground font-normal">(optional)</span>
                      </label>
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
                        <label className="text-sm font-medium block mb-2">
                          Target audience <span className="text-muted-foreground font-normal">(optional)</span>
                        </label>
                        <Input
                          className="h-11 rounded-lg"
                          style={{ fontSize: "16px" }}
                          placeholder="e.g. B2B SaaS founders"
                          value={targetAudience}
                          onChange={(e) => setTargetAudience(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium block mb-2">
                          Brand tone <span className="text-muted-foreground font-normal">(optional)</span>
                        </label>
                        <Input
                          className="h-11 rounded-lg"
                          style={{ fontSize: "16px" }}
                          placeholder="e.g. bold, direct"
                          value={tone}
                          onChange={(e) => setTone(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-8 flex flex-col gap-3">
                  <Button
                    size="lg"
                    className="w-full h-12 rounded-xl text-base"
                    onClick={handleProductContinue}
                    disabled={busy}
                  >
                    {busy ? "Saving…" : productName.trim() ? "Continue" : "Skip for now"}
                  </Button>
                  {productName.trim() && (
                    <button
                      className="text-sm text-muted-foreground hover:text-foreground transition text-center"
                      onClick={() => setStep(SOCIALS_STEP)}
                      disabled={busy}
                    >
                      Skip for now
                    </button>
                  )}
                </div>
              </motion.div>
            )}

            {/* ── Connect socials ─────────────────────────────────────────── */}
            {step === SOCIALS_STEP && (
              <motion.div
                key="socials"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.32, ease }}
              >
                <div className="mb-10 sm:mb-12">
                  <p className="mk-eyebrow mb-4">Connect your accounts</p>
                  <h2 className="text-[28px] sm:text-[34px] font-semibold leading-[1.1] tracking-[-0.03em]">
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
                    TikTok, Threads, and Pinterest can be connected per-product from your dashboard.
                  </p>
                </div>

                <div className="mt-8 flex flex-col gap-3">
                  <Button
                    size="lg"
                    className="w-full h-12 rounded-xl text-base"
                    onClick={() => setStep(GENERATING_STEP)}
                  >
                    {Object.keys(connected).length > 0
                      ? "Continue"
                      : "Skip and continue"}
                  </Button>
                  <button
                    className="text-sm text-muted-foreground hover:text-foreground transition text-center"
                    onClick={() => setStep(PRODUCT_STEP)}
                  >
                    ← Back
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Generating ──────────────────────────────────────────────── */}
            {step === GENERATING_STEP && (
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
                  <h2 className="text-[24px] sm:text-[28px] font-semibold tracking-[-0.025em] mb-4">
                    Building your workflow
                  </h2>
                  <p className="text-base text-muted-foreground max-w-sm leading-relaxed">
                    Setting up your channels and a posting plan built around {challenge.short} — the problem you came here to solve.
                  </p>
                  <p className="mt-8 text-sm text-muted-foreground">
                    This takes just a moment
                  </p>
                </div>
              </motion.div>
            )}

            {/* ── Paywall ─────────────────────────────────────────────────── */}
            {step === PAYWALL_STEP && (
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
                    className="inline-flex h-12 w-12 items-center justify-center rounded-full mb-6"
                    style={{
                      background: "color-mix(in oklch, var(--mk-pos) 12%, var(--mk-paper))",
                      border: "1px solid color-mix(in oklch, var(--mk-pos) 26%, var(--mk-rule))",
                    }}
                  >
                    <span className="font-bold text-base" style={{ color: "var(--mk-pos)" }}>
                      ✓
                    </span>
                  </motion.div>
                  <h2 className="text-[28px] sm:text-[34px] font-semibold leading-[1.1] tracking-[-0.03em]">
                    {challenge.headline}
                  </h2>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                    {challenge.line} You&apos;ll get back about{" "}
                    <span className="font-semibold text-foreground">{hoursSaved} hours a week</span>.
                    Start your {TRIAL_DAYS}-day free trial to publish — and everything else you create.
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
                      productName={productName || "Your brand"}
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
                  <p className="text-center text-xs text-muted-foreground mt-1.5">
                    Your trial ends on {trialEndLabel}, when your card is charged $
                    {interval === "annual" ? PLANS[selectedTier].price.annual : PLANS[selectedTier].price.monthly}
                    /mo{interval === "annual" ? ", billed annually" : ""}. Cancel anytime before then and you won&apos;t be charged.
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
