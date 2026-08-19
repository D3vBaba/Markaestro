"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useAuth, friendlyAuthError } from "@/components/providers/AuthProvider";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiPost, getApiWorkspaceId } from "@/lib/api-client";
import { ONBOARDING_STATE_KEY, allowedOnboardingStep } from "@/lib/onboarding-state";
import { deferFromEffect } from "@/lib/defer-from-effect";
import { startOAuthAuthorize } from "@/lib/in-app-browser";
import { useProductScan } from "@/hooks/useProductScan";
import ScanProgressStepper from "@/components/app/ScanProgressStepper";
import { PLANS, PLAN_TIERS, TRIAL_DAYS } from "@/lib/stripe/plans";
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
// likely to register and start a trial. Copy lives in messages/{locale}/appOnboarding.json
// under `quiz.<id>`; this table only carries the structural shape (ids, question
// type, whether options carry a `desc` line, layout).

type QuizQuestionMeta = {
  id: string;
  type: "single" | "multi";
  hasSubtitle: boolean;
  hasDesc: boolean;
  optionIds: string[];
  columns?: boolean; // render options in two columns
};

const QUIZ_QUESTIONS_META: QuizQuestionMeta[] = [
  { id: "marketing", type: "single", hasSubtitle: true, hasDesc: true, optionIds: ["product", "business", "personal", "clients"] },
  { id: "role", type: "single", hasSubtitle: true, hasDesc: true, optionIds: ["founder", "marketer", "agency", "creator"] },
  { id: "teamSize", type: "single", hasSubtitle: false, hasDesc: true, optionIds: ["solo", "small", "medium", "large"] },
  { id: "goal", type: "single", hasSubtitle: true, hasDesc: true, optionIds: ["social", "sales", "time"] },
  { id: "channels", type: "multi", hasSubtitle: true, hasDesc: false, columns: true, optionIds: ["instagram", "facebook", "tiktok", "threads", "pinterest", "linkedin"] },
  { id: "postingToday", type: "single", hasSubtitle: true, hasDesc: true, optionIds: ["manual", "spreadsheet", "tool", "starting"] },
  { id: "frequency", type: "single", hasSubtitle: true, hasDesc: true, optionIds: ["daily", "few", "weekly", "unsure"] },
  { id: "challenge", type: "single", hasSubtitle: true, hasDesc: true, optionIds: ["consistency", "time", "ideas", "juggling"] },
  { id: "contentTypes", type: "multi", hasSubtitle: true, hasDesc: false, columns: true, optionIds: ["product", "educational", "bts", "news"] },
  { id: "hoursPerWeek", type: "single", hasSubtitle: true, hasDesc: false, optionIds: ["lt2", "2to5", "5to10", "gt10"] },
  { id: "success", type: "single", hasSubtitle: true, hasDesc: true, optionIds: ["followers", "sales", "timeback", "consistency"] },
];

type Answers = Record<string, string | string[]>;

const MARKETING_KEYS = ["product", "business", "personal", "clients"];
const CHALLENGE_KEYS = ["consistency", "time", "ideas", "juggling"];

// Sensible default category per marketing type — a starting point the user
// can change in the manual form or later in the brand's settings.
const MARKETING_DEFAULT_CATEGORY: Record<string, string> = {
  product: "saas",
  business: "local-business",
  personal: "personal-brand",
  clients: "agency",
};

const SOCIAL_PROVIDERS = ["meta"];

// ─── Step indices ─────────────────────────────────────────────────────────────
// 0..QUIZ_COUNT-1 = the quiz questions
// then: register (skipped when already signed in) → add a brand
// (scan / manual / skip) → connect socials → generating (transient
// loader) → paywall

const QUIZ_COUNT = QUIZ_QUESTIONS_META.length;
const REGISTER_STEP = QUIZ_COUNT;
const PRODUCT_STEP = QUIZ_COUNT + 1;
const SOCIALS_STEP = QUIZ_COUNT + 2;
const GENERATING_STEP = QUIZ_COUNT + 3;
const PAYWALL_STEP = QUIZ_COUNT + 4;

// Ordered list of user-facing screens (the transient generating loader excluded)
// used to drive the progress bar.
const FLOW_STEPS = [
  ...QUIZ_QUESTIONS_META.map((_, i) => i),
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

// v4: the "What are you marketing?" question shifted every step index, so
// stale v3 sessions must not resume onto the wrong screen.
const STORAGE_KEY = ONBOARDING_STATE_KEY;

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
  const t = useTranslations("onboarding.product");
  return (
    <span className="ms-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary align-middle">
      {t("autoDetected")}
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
      className="w-full rounded-xl p-4 sm:p-5 text-start transition-colors duration-150 min-h-[72px] active:scale-[0.99]"
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
  const t = useTranslations("onboarding.paywall");
  return (
    <div
      className={cn(
        "relative rounded-xl border bg-background overflow-hidden",
        locked && "select-none"
      )}
    >
      {locked && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/85 backdrop-blur-sm rounded-xl">
          <p className="text-sm font-semibold">{t("subscribeToPublish")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("postReadyOneStepAway")}</p>
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
            <p className="text-xs text-muted-foreground">{t("justNow")}</p>
          </div>
        </div>
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-line line-clamp-6">
          {content}
        </p>
        <div className="mt-4 pt-4 border-t flex gap-6 text-xs text-muted-foreground">
          <span>{t("like")}</span>
          <span>{t("comment")}</span>
          <span>{t("share")}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Full marketing footer ────────────────────────────────────────────────────

function OnboardingFooter() {
  const t = useTranslations("onboarding.footer");
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
              {t("tagline")}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">
              {t("product")}
            </p>
            <div className="mt-5 flex flex-col gap-3">
              <Link href="/features" className="text-sm text-muted-foreground hover:text-foreground transition">{t("features")}</Link>
              <Link href="/channels" className="text-sm text-muted-foreground hover:text-foreground transition">{t("channels")}</Link>
              <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition">{t("pricing")}</Link>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">
              {t("company")}
            </p>
            <div className="mt-5 flex flex-col gap-3">
              <Link href="/contact" className="text-sm text-muted-foreground hover:text-foreground transition">{t("contact")}</Link>
              <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground transition">{t("termsOfService")}</Link>
              <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition">{t("privacyPolicy")}</Link>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">
              {t("getStarted")}
            </p>
            <div className="mt-5 flex flex-col gap-3">
              <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition">{t("signIn")}</Link>
              <Link href="/onboarding" className="text-sm text-muted-foreground hover:text-foreground transition">{t("createAccount")}</Link>
            </div>
          </div>
        </div>

        <div className="mt-16 flex flex-col items-center gap-4 border-t pt-8 sm:flex-row sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {t("copyright", { year: new Date().getFullYear() })}
          </p>
          <div className="flex gap-6">
            <Link href="/terms" className="text-xs text-muted-foreground hover:text-foreground transition">{t("terms")}</Link>
            <Link href="/privacy" className="text-xs text-muted-foreground hover:text-foreground transition">{t("privacy")}</Link>
            <Link href="/contact" className="text-xs text-muted-foreground hover:text-foreground transition">{t("contact")}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const t = useTranslations("onboarding");
  const tQuiz = useTranslations("onboarding.quiz");
  const tChallenge = useTranslations("onboarding.challengeCopy");
  const tMarketing = useTranslations("onboarding.marketingCopy");
  const tSocialProviders = useTranslations("onboarding.socialProviders");
  const tAuthErrors = useTranslations("appCommon.authErrors");
  const locale = useLocale();
  const {
    user,
    loading: authLoading,
    logout,
    requestSignInCode,
    signInWithCode,
    signInGoogle,
  } = useAuth();
  const { status: subStatus, loading: subLoading, refresh: refreshSubscription } = useSubscription();
  const router = useRouter();

  const saved = loadState();

  const [step, setStep] = useState(saved.step ?? 0);
  // Sampled once per mount: the trial-end date must not shift because React
  // re-rendered, and it is only ever shown as a reassurance label.
  const [trialStartedAt] = useState(() => Date.now());
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
  const [freeBusy, setFreeBusy] = useState(false);

  // Register — passwordless: email first, then the one-time code we sent.
  const [regStage, setRegStage] = useState<"email" | "code">("email");
  const [regEmail, setRegEmail] = useState("");
  const [regCode, setRegCode] = useState("");
  const [regError, setRegError] = useState("");
  const [regBusy, setRegBusy] = useState(false);
  const [regCooldown, setRegCooldown] = useState(0);

  useEffect(() => {
    if (regCooldown <= 0) return;
    const timer = setTimeout(() => setRegCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [regCooldown]);

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
  // Adjusted during render so the register step is never painted again after
  // the account exists.
  if (user && step === REGISTER_STEP) {
    setRegBusy(false);
    setStep(PRODUCT_STEP);
  }

  // The mirror image: the quiz is public, but everything past the register
  // step is not. sessionStorage resumes whatever step the tab was last on, so
  // signing out and returning to /onboarding used to land straight back on the
  // paywall — a signed-out visitor being asked for a card. Pull them back to
  // register, which is where the flow gates on an account existing.
  const gatedStep = allowedOnboardingStep({
    step,
    registerStep: REGISTER_STEP,
    signedIn: Boolean(user),
    authLoading,
  });
  if (gatedStep !== step) {
    setStep(gatedStep);
  }

  // ─── OAuth return ───────────────────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("oauth");
    const oauthProvider = params.get("provider");
    const oauthProductId = params.get("productId");
    if (oauthResult && oauthProvider) {
      deferFromEffect(() => {
      if (oauthProductId) {
        setProductId(oauthProductId);
      }
      if (oauthResult === "success") {
        setConnected((prev) => ({ ...prev, [oauthProvider]: true }));
        const label = oauthProvider === "meta" ? tSocialProviders("meta.fullLabel") : oauthProvider;
        toast.success(t("socials.connectedToast", { label }));
      } else {
        toast.error(t("socials.connectFailedToast", { provider: oauthProvider }));
      }
      window.history.replaceState({}, "", "/onboarding");
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Generating → paywall ─────────────────────────────────────────────────

  useEffect(() => {
    if (step !== GENERATING_STEP) return;
    const timer = setTimeout(() => setStep(PAYWALL_STEP), 2200);
    return () => clearTimeout(timer);
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

  // Derived from the answers, so it is adjusted during render: the recommended
  // tier is already highlighted on the frame that reveals the plan step.
  const recommendRole = (answers.role as string) || "";
  const recommendTeamSize = (answers.teamSize as string) || "";
  const recommendKey = `${recommendRole}|${recommendTeamSize}`;
  const [recommendedFor, setRecommendedFor] = useState(recommendKey);
  if (recommendKey !== recommendedFor) {
    setRecommendedFor(recommendKey);
    if (recommendRole && recommendTeamSize) {
      setSelectedTier(recommendPlan(recommendRole, recommendTeamSize));
    }
  }

  if (authLoading || (user && subLoading)) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="h-8 w-8 rounded-lg bg-primary animate-pulse" />
      </div>
    );
  }

  if (user && subStatus?.active) return null;

  const trialEndLabel = new Date(
    trialStartedAt + TRIAL_DAYS * 24 * 60 * 60 * 1000,
  ).toLocaleDateString(locale, { month: "long", day: "numeric" });

  const hoursSaved = HOURS_SAVED[(answers.hoursPerWeek as string)] ?? 6;
  const channelCount = Array.isArray(answers.channels) ? (answers.channels as string[]).length : 0;
  const frequencyOptId = answers.frequency as string | undefined;
  const frequencyLabel = frequencyOptId
    ? tQuiz(`frequency.options.${frequencyOptId}.label`).toLowerCase()
    : t("register.recap.onSteadyCadence");
  const challengeKey = CHALLENGE_KEYS.includes(answers.challenge as string) ? (answers.challenge as string) : "time";
  const challenge = {
    short: tChallenge(`${challengeKey}.short`),
    headline: tChallenge(`${challengeKey}.headline`),
    line: tChallenge(`${challengeKey}.line`),
  };
  const marketingKey = MARKETING_KEYS.includes(answers.marketing as string) ? (answers.marketing as string) : "fallback";
  const marketing = {
    eyebrow: tMarketing(`${marketingKey}.eyebrow`),
    title: tMarketing(`${marketingKey}.title`),
    sub: tMarketing(`${marketingKey}.sub`),
  };

  // ─── Quiz helpers ─────────────────────────────────────────────────────────

  function answerSingle(questionId: string, optionId: string, nextStep: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    if (questionId === "marketing") {
      // Seed the brand step with a fitting default category (still editable
      // in the manual form), and lead personal brands with the manual path —
      // they often have no website to scan.
      setProductCategory(MARKETING_DEFAULT_CATEGORY[optionId] ?? "other");
      if (optionId === "personal") setProductMode("manual");
    }
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
    const res = await apiPost<{ id: string }>("/api/products", {
        name: productName.trim() || "My brand",
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
      toast.error(t("product.couldntSaveBrand"));
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
        workspaceId: getApiWorkspaceId(),
        productId: ensuredProductId,
        returnTo,
      });
      skipLeaveGuardRef.current = true;
      startOAuthAuthorize(`/api/oauth/authorize/${providerId}?${qs.toString()}`);
    } catch {
      toast.error(t("socials.couldNotInitiate"));
    } finally {
      setConnectingProvider(null);
    }
  }

  // ─── Register handlers ──────────────────────────────────────────────────────

  async function handleSendRegCode() {
    if (!regEmail.trim()) {
      setRegError(t("register.errors.enterEmail"));
      return;
    }
    setRegError("");
    setRegBusy(true);
    try {
      await requestSignInCode(regEmail.trim());
      setRegStage("code");
      setRegCode("");
      setRegCooldown(60);
      setRegBusy(false);
    } catch (e: unknown) {
      // A recent code is still valid — let the user go enter it.
      if (e instanceof Error && e.message === "OTP_COOLDOWN") {
        setRegStage("code");
        setRegCooldown(60);
        setRegBusy(false);
      } else {
        setRegError(friendlyAuthError(e, tAuthErrors));
        setRegBusy(false);
      }
    }
  }

  async function handleVerifyRegCode() {
    if (regCode.length < 6) {
      setRegError(t("register.errors.enterCode"));
      return;
    }
    setRegError("");
    setRegBusy(true);
    try {
      await signInWithCode(regEmail.trim(), regCode);
      // onAuthStateChanged sets the user; the guard effect advances the step.
      // Keep regBusy true so the button stays in its loading state until then.
    } catch (e: unknown) {
      setRegError(friendlyAuthError(e, tAuthErrors));
      setRegBusy(false);
    }
  }

  async function handleSocialRegister() {
    setRegError("");
    setRegBusy(true);
    try {
      await signInGoogle();
    } catch (e: unknown) {
      setRegError(friendlyAuthError(e, tAuthErrors));
      setRegBusy(false);
    }
  }

  // Continue into the app on the Free plan — no checkout. The app shell's
  // onboarding gate (`/api/onboarding/status`) treats a workspace as onboarded
  // once it has EITHER a product OR subscription history; with no checkout on
  // this path, the brand must exist before we leave (falls back to a
  // placeholder name the user can rename later — same as connectSocial).
  async function handleContinueFree() {
    setFreeBusy(true);
    try {
      await ensureOnboardingProduct();
      // Force-refresh the shared bootstrap cache so the dashboard's shell sees
      // hasProducts=true instead of a stale snapshot bouncing us back here.
      await refreshSubscription();
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      router.replace("/dashboard");
    } catch {
      toast.error(t("paywall.freeOption.failed"));
      setFreeBusy(false);
    }
  }

  function handleCheckout() {
    // The quiz (and therefore the paywall, once sessionStorage restores the
    // step) is reachable while signed out — after a logout, or on a back
    // navigation into a restored flow. Posting checkout there always 401s and
    // surfaced as "checkout failed", which reads as a broken Stripe
    // integration. Send them to the register step instead: the account has to
    // exist before there is a workspace to bill.
    if (!user) {
      setStep(REGISTER_STEP);
      return;
    }
    setBusy(true);
    // Scoped to the selected workspace — billing is per-workspace, and the
    // server would otherwise resolve one from the cookie, which a freshly
    // bootstrapped onboarding account may not have yet.
    apiPost<{ url: string }>("/api/stripe/checkout", { tier: selectedTier, interval })
      .then((res) => {
        if (res.ok && res.data.url) {
          skipLeaveGuardRef.current = true;
          window.location.href = res.data.url;
          return;
        }
        toast.error(
          res.status === 401
            ? t("paywall.checkoutSignedOut")
            : res.status === 403
              ? t("paywall.checkoutNotOwner")
              : t("paywall.checkoutFailed"),
        );
        setBusy(false);
      })
      .catch(() => {
        toast.error(t("paywall.checkoutFailed"));
        setBusy(false);
      });
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  const currentQuestionMeta = step < QUIZ_COUNT ? QUIZ_QUESTIONS_META[step] : null;

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
                {t("questionCounter", { current: step + 1, total: QUIZ_COUNT })}
              </span>
            )}
            {user ? (
              <button
                className="text-[12.5px] transition-colors"
                style={{ color: "var(--mk-ink-60)" }}
                onClick={logout}
              >
                {t("signOut")}
              </button>
            ) : (
              <Link
                href="/login"
                className="text-[12.5px] transition-colors"
                style={{ color: "var(--mk-ink-60)" }}
              >
                {t("signIn")}
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
            {currentQuestionMeta && (
              <motion.div
                key={`q-${currentQuestionMeta.id}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.32, ease }}
              >
                <div className="mb-10 sm:mb-12">
                  <p className="mk-eyebrow mb-4">{tQuiz(`${currentQuestionMeta.id}.eyebrow`)}</p>
                  <h1 className="text-[28px] sm:text-[34px] font-semibold leading-[1.1] tracking-[-0.03em]">
                    {tQuiz(`${currentQuestionMeta.id}.title`)}
                  </h1>
                  {currentQuestionMeta.hasSubtitle && (
                    <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                      {tQuiz(`${currentQuestionMeta.id}.subtitle`)}
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
                      {t("takes2Minutes")}
                    </div>
                  )}
                </div>

                <div className={cn("grid gap-3", currentQuestionMeta.columns && "sm:grid-cols-2")}>
                  {currentQuestionMeta.optionIds.map((optId, i) => {
                    const label = tQuiz(`${currentQuestionMeta.id}.options.${optId}.label`);
                    const desc = currentQuestionMeta.hasDesc
                      ? tQuiz(`${currentQuestionMeta.id}.options.${optId}.desc`)
                      : undefined;
                    if (currentQuestionMeta.type === "multi") {
                      const sel = Array.isArray(answers[currentQuestionMeta.id])
                        ? (answers[currentQuestionMeta.id] as string[]).includes(optId)
                        : false;
                      return (
                        <SelectionTile
                          key={optId}
                          multi
                          selected={sel}
                          label={label}
                          desc={desc}
                          delay={i * 0.04}
                          onClick={() => toggleMulti(currentQuestionMeta.id, optId)}
                        />
                      );
                    }
                    return (
                      <SelectionTile
                        key={optId}
                        selected={answers[currentQuestionMeta.id] === optId}
                        label={label}
                        desc={desc}
                        delay={i * 0.05}
                        onClick={() => answerSingle(currentQuestionMeta.id, optId, step + 1)}
                      />
                    );
                  })}
                </div>

                {/* Multi-select steps need an explicit advance button. */}
                {currentQuestionMeta.type === "multi" && (
                  <div className="mt-8">
                    <Button
                      size="lg"
                      className="w-full h-12 rounded-xl text-base"
                      onClick={() => setStep(step + 1)}
                    >
                      {Array.isArray(answers[currentQuestionMeta.id]) &&
                      (answers[currentQuestionMeta.id] as string[]).length > 0
                        ? t("continue")
                        : t("skipForNow")}
                    </Button>
                  </div>
                )}

                {step > 0 && (
                  <button
                    className="mt-6 text-sm text-muted-foreground hover:text-foreground transition"
                    onClick={() => setStep(step - 1)}
                  >
                    {t("back")}
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
                  <p className="mk-eyebrow mb-4">{t("register.yourPlanIsReady")}</p>
                  <h2 className="text-[28px] sm:text-[34px] font-semibold leading-[1.1] tracking-[-0.03em]">
                    {regStage === "email"
                      ? t("register.titleEmail")
                      : t("register.titleCode")}
                  </h2>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                    {regStage === "email"
                      ? t("register.subtitleEmail")
                      : t("register.subtitleCode", { email: regEmail.trim() })}
                  </p>
                </div>

                {/* Personalised recap — shows what they built so registering
                    feels like claiming it back, not filling out a form. */}
                {regStage === "email" && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease }}
                    className="mb-6 rounded-xl border p-5"
                    style={{ background: "var(--mk-panel)", borderColor: "var(--mk-rule)" }}
                  >
                    <p className="mk-eyebrow mb-3">{t("register.waitingInWorkspace")}</p>
                    <div className="flex flex-col gap-2.5">
                      {[
                        channelCount > 0
                          ? t("register.recap.channelsReady", { count: channelCount })
                          : t("register.recap.everyChannel"),
                        t("register.recap.postsScheduled", { frequency: frequencyLabel }),
                        t("register.recap.hoursBack", { hours: hoursSaved }),
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
                  <div className="flex flex-col gap-3">
                    {regStage === "email" ? (
                      <Input
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder={t("register.emailPlaceholder")}
                        type="email"
                        autoComplete="email"
                        className="h-11 rounded-lg"
                        style={{ fontSize: "16px" }}
                        onKeyDown={(e) => e.key === "Enter" && !regBusy && handleSendRegCode()}
                      />
                    ) : (
                      <Input
                        value={regCode}
                        onChange={(e) => setRegCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder={t("register.codePlaceholder")}
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        className="h-12 rounded-lg text-center font-mono tracking-[0.4em]"
                        style={{ fontSize: "20px" }}
                        onKeyDown={(e) => e.key === "Enter" && !regBusy && handleVerifyRegCode()}
                      />
                    )}

                    {regError && (
                      <p className="rounded-lg px-3.5 py-2.5 text-[12px] bg-destructive/10 text-destructive">
                        {regError}
                      </p>
                    )}

                    {regStage === "email" ? (
                      <Button
                        className="h-11 w-full rounded-lg text-[14px]"
                        disabled={regBusy}
                        onClick={handleSendRegCode}
                      >
                        {regBusy ? t("register.sendingCode") : t("register.claimPlan")}
                      </Button>
                    ) : (
                      <>
                        <Button
                          className="h-11 w-full rounded-lg text-[14px]"
                          disabled={regBusy || regCode.length < 6}
                          onClick={handleVerifyRegCode}
                        >
                          {regBusy ? t("register.verifying") : t("register.continueBtn")}
                        </Button>
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            className="text-[12px] text-muted-foreground hover:text-foreground transition"
                            onClick={() => { setRegStage("email"); setRegCode(""); setRegError(""); }}
                          >
                            {t("register.useDifferentEmail")}
                          </button>
                          <button
                            type="button"
                            className="text-[12px] font-medium hover:underline disabled:opacity-50 disabled:no-underline"
                            style={{ color: "var(--mk-accent)" }}
                            disabled={regBusy || regCooldown > 0}
                            onClick={handleSendRegCode}
                          >
                            {regCooldown > 0 ? t("register.resendIn", { seconds: regCooldown }) : t("register.resendCode")}
                          </button>
                        </div>
                      </>
                    )}
                    {regStage === "email" && (
                      <p className="text-center text-[12px]" style={{ color: "var(--mk-ink-40)" }}>
                        {t("register.freeTrialNote")}
                      </p>
                    )}
                  </div>

                  <div className="relative my-5 flex items-center gap-3">
                    <span className="flex-1 h-px" style={{ background: "var(--mk-rule)" }} />
                    <span
                      className="font-mono text-[9.5px] uppercase"
                      style={{ color: "var(--mk-ink-40)", letterSpacing: "0.18em" }}
                    >
                      {t("register.orContinueWith")}
                    </span>
                    <span className="flex-1 h-px" style={{ background: "var(--mk-rule)" }} />
                  </div>

                  <Button
                    variant="outline"
                    className="h-11 w-full rounded-lg gap-2 text-[13.5px]"
                    disabled={regBusy}
                    onClick={() => handleSocialRegister()}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    {t("register.continueWithGoogle")}
                  </Button>
                </div>

                <p className="mt-5 text-center text-[11.5px]" style={{ color: "var(--mk-ink-40)" }}>
                  {t("register.agreeTermsPrefix")}{" "}
                  <Link href="/terms" className="hover:underline" style={{ color: "var(--mk-ink-60)" }}>{t("register.terms")}</Link>{" "}
                  {t("register.and")}{" "}
                  <Link href="/privacy" className="hover:underline" style={{ color: "var(--mk-ink-60)" }}>{t("register.privacyPolicy")}</Link>.
                </p>

                <button
                  className="mt-4 text-sm text-muted-foreground hover:text-foreground transition mx-auto block"
                  onClick={() => setStep(QUIZ_COUNT - 1)}
                >
                  {t("back")}
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
                  <p className="mk-eyebrow mb-4">{marketing.eyebrow}</p>
                  <h2 className="text-[28px] sm:text-[34px] font-semibold leading-[1.1] tracking-[-0.03em]">
                    {marketing.title}
                  </h2>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                    {marketing.sub}
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
                      {m === "scan" ? t("product.scanWebsite") : t("product.enterManually")}
                    </button>
                  ))}
                </div>

                {productMode === "scan" ? (
                  <div className="rounded-xl border p-5 sm:p-6 space-y-5">
                    <div>
                      <label className="text-sm font-medium text-foreground block mb-2">
                        {t("product.websiteUrl")}
                      </label>
                      <div className="flex gap-2.5">
                        <Input
                          placeholder={t("product.urlPlaceholder")}
                          className="h-12 rounded-lg text-base flex-1"
                          style={{ fontSize: "16px" }}
                          value={productUrl}
                          onChange={(e) => { setProductUrl(e.target.value); if (scanDone) { resetScan(); setAutoFilled({}); } }}
                          onKeyDown={(e) => e.key === "Enter" && !scanning && scanUrl()}
                        />
                        <Button
                          className="h-12 rounded-lg shrink-0 text-sm font-medium w-28 px-0 sm:w-auto sm:px-5"
                          onClick={scanUrl}
                          disabled={scanning || !productUrl.trim()}
                          variant={scanDone ? "outline" : "default"}
                        >
                          {scanning ? t("product.scanning") : scanDone ? t("product.rescan") : t("product.scan")}
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                        {t("product.scanHelp")}
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
                            {t("product.brandName")}
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
                            {t("product.description")}
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
                              {t("product.targetAudience")}
                              {autoFilled.targetAudience && <AutoDetectedBadge />}
                            </label>
                            <Input
                              className="h-11 rounded-lg"
                              style={{ fontSize: "16px" }}
                              value={targetAudience}
                              onChange={(e) => { setTargetAudience(e.target.value); setAutoFilled((p) => ({ ...p, targetAudience: false })); }}
                              placeholder={t("product.targetAudiencePlaceholder")}
                            />
                          </div>
                          <div>
                            <label className="text-sm font-medium block mb-2">
                              {t("product.brandTone")}
                              {autoFilled.tone && <AutoDetectedBadge />}
                            </label>
                            <Input
                              className="h-11 rounded-lg"
                              style={{ fontSize: "16px" }}
                              value={tone}
                              onChange={(e) => { setTone(e.target.value); setAutoFilled((p) => ({ ...p, tone: false })); }}
                              placeholder={t("product.brandTonePlaceholder")}
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
                              {t("product.brandColorDetected")}{" "}
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
                      <label className="text-sm font-medium block mb-2">{t("product.brandName")}</label>
                      <Input
                        className="h-12 rounded-lg"
                        style={{ fontSize: "16px" }}
                        placeholder={t("product.manualBrandNamePlaceholder")}
                        value={productName}
                        onChange={(e) => setProductName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium block mb-2">
                        {t("product.whatDoesItDo")} <span className="text-muted-foreground font-normal">{t("product.optional")}</span>
                      </label>
                      <textarea
                        className="w-full rounded-lg border bg-background px-3 py-3 text-base min-h-[108px] resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 leading-relaxed"
                        style={{ fontSize: "16px" }}
                        placeholder={t("product.manualDescPlaceholder")}
                        value={productDesc}
                        onChange={(e) => setProductDesc(e.target.value)}
                      />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium block mb-2">
                          {t("product.targetAudience")} <span className="text-muted-foreground font-normal">{t("product.optional")}</span>
                        </label>
                        <Input
                          className="h-11 rounded-lg"
                          style={{ fontSize: "16px" }}
                          placeholder={t("product.targetAudiencePlaceholder")}
                          value={targetAudience}
                          onChange={(e) => setTargetAudience(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium block mb-2">
                          {t("product.brandTone")} <span className="text-muted-foreground font-normal">{t("product.optional")}</span>
                        </label>
                        <Input
                          className="h-11 rounded-lg"
                          style={{ fontSize: "16px" }}
                          placeholder={t("product.brandTonePlaceholder")}
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
                    {busy ? t("product.saving") : productName.trim() ? t("continue") : t("skipForNow")}
                  </Button>
                  {productName.trim() && (
                    <button
                      className="text-sm text-muted-foreground hover:text-foreground transition text-center"
                      onClick={() => setStep(SOCIALS_STEP)}
                      disabled={busy}
                    >
                      {t("skipForNow")}
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
                  <p className="mk-eyebrow mb-4">{t("socials.connectYourAccounts")}</p>
                  <h2 className="text-[28px] sm:text-[34px] font-semibold leading-[1.1] tracking-[-0.03em]">
                    {t("socials.addSocialAccounts")}
                  </h2>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                    {t("socials.subtitle")}
                  </p>
                </div>

                <div className="space-y-3">
                  {SOCIAL_PROVIDERS.map((providerId, i) => {
                    const isConnected = connected[providerId];
                    const isConnecting = connectingProvider === providerId;
                    return (
                      <motion.div
                        key={providerId}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.07, duration: 0.3, ease }}
                        className={cn(
                          "rounded-xl border p-5 flex items-center justify-between gap-5 transition-all",
                          isConnected ? "border-primary bg-primary/3" : "border-border"
                        )}
                      >
                        <div className="min-w-0">
                          <p className="text-base font-medium">{tSocialProviders(`${providerId}.label`)}</p>
                          <p className="text-sm text-muted-foreground mt-0.5 leading-snug">
                            {tSocialProviders(`${providerId}.description`)}
                          </p>
                          <p className="text-xs text-muted-foreground/70 mt-0.5">{tSocialProviders(`${providerId}.note`)}</p>
                        </div>
                        {isConnected ? (
                          <span className="text-sm font-medium text-emerald-600 shrink-0">
                            {t("socials.connected")}
                          </span>
                        ) : (
                          <Button
                            variant="outline"
                            className="rounded-lg text-sm h-10 px-5 shrink-0"
                            onClick={() => connectSocial(providerId)}
                            disabled={isConnecting}
                          >
                            {isConnecting ? t("socials.redirecting") : t("socials.connect")}
                          </Button>
                        )}
                      </motion.div>
                    );
                  })}

                  <p className="text-sm text-muted-foreground px-1 pt-1">
                    {t("socials.otherChannelsNote")}
                  </p>
                </div>

                <div className="mt-8 flex flex-col gap-3">
                  <Button
                    size="lg"
                    className="w-full h-12 rounded-xl text-base"
                    onClick={() => setStep(GENERATING_STEP)}
                  >
                    {Object.keys(connected).length > 0
                      ? t("continue")
                      : t("socials.skipAndContinue")}
                  </Button>
                  <button
                    className="text-sm text-muted-foreground hover:text-foreground transition text-center"
                    onClick={() => setStep(PRODUCT_STEP)}
                  >
                    {t("back")}
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
                    {t("generating.title")}
                  </h2>
                  <p className="text-base text-muted-foreground max-w-sm leading-relaxed">
                    {t("generating.subtitle", { challenge: challenge.short })}
                  </p>
                  <p className="mt-8 text-sm text-muted-foreground">
                    {t("generating.takesAMoment")}
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
                    {challenge.line} {t("paywall.youllGetBackPrefix")}{" "}
                    <span className="font-semibold text-foreground">{hoursSaved} {t("paywall.hoursAWeek")}</span>.{" "}
                    {t("paywall.startTrialSuffix", { days: TRIAL_DAYS })}
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
                      {t("paywall.firstPostReady")}
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
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 mb-5">
                    <p className="text-base font-semibold">{t("paywall.recommendedForYou")}</p>
                    <span className="text-sm text-muted-foreground">{t("paywall.basedOnAnswers")}</span>
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
                          {iv === "monthly" ? t("paywall.monthly") : (
                            <>
                              {t("paywall.annual")}<span className="hidden sm:inline"> {t("paywall.saveAnnual")}</span>
                              <span className="sm:hidden"> {t("paywall.saveAnnualShort")}</span>
                            </>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Plan cards */}
                  <div className="grid gap-4 sm:gap-3 sm:grid-cols-3">
                    {PLAN_TIERS.map((tierKey) => {
                      const plan = PLANS[tierKey];
                      const price = interval === "annual" ? plan.price.annual : plan.price.monthly;
                      const isSelected = selectedTier === tierKey;
                      return (
                        <button
                          key={tierKey}
                          className={cn(
                            "rounded-xl border p-5 text-start transition-all relative active:scale-[0.99]",
                            isSelected
                              ? "border-primary bg-primary/3 shadow-sm"
                              : "border-border/60 hover:border-foreground/30"
                          )}
                          onClick={() => setSelectedTier(tierKey)}
                        >
                          {plan.badge && isSelected && (
                            <span className="absolute -top-2.5 start-3 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold text-white uppercase tracking-wide">
                              {plan.badge}
                            </span>
                          )}
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-sm font-semibold text-foreground">{plan.name}</p>
                            {isSelected && (
                              <span className="text-[10px] font-bold text-primary uppercase tracking-wide">
                                {t("paywall.selected")}
                              </span>
                            )}
                          </div>
                          <p className="text-2xl font-bold text-foreground">${price}</p>
                          <p className="text-xs text-muted-foreground">{t("paywall.perMonth")}</p>
                          {interval === "annual" && (
                            <p className="text-xs text-muted-foreground mt-1 line-through">
                              ${plan.price.monthly}{t("paywall.perMonthShort")}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Trial messaging — both intervals now have trial */}
                  <p className="text-center text-sm font-medium mt-4 text-emerald-600">
                    {t("paywall.trialAllPlans", { days: TRIAL_DAYS, dayAfter: TRIAL_DAYS + 1 })}
                  </p>
                  <p className="text-center text-xs text-muted-foreground mt-1.5">
                    {t("paywall.trialEndsOn", {
                      date: trialEndLabel,
                      price: interval === "annual" ? PLANS[selectedTier].price.annual : PLANS[selectedTier].price.monthly,
                      billedAnnually: interval === "annual" ? t("paywall.billedAnnually") : "",
                    })}
                  </p>
                  {interval === "annual" && (
                    <p className="text-center text-xs text-muted-foreground mt-1">
                      {t("paywall.annualSavingsNote")}
                    </p>
                  )}

                  <Button
                    size="lg"
                    className="w-full mt-6 h-13 rounded-xl px-3 sm:px-6 text-[14px] sm:text-base"
                    onClick={handleCheckout}
                    disabled={busy || freeBusy}
                  >
                    {busy
                      ? t("paywall.settingUp")
                      : t("paywall.startTrialButton", { days: TRIAL_DAYS, plan: PLANS[selectedTier].name })}
                  </Button>
                  <p className="text-center text-sm text-muted-foreground mt-3">
                    {t("paywall.cardRequired")}
                  </p>

                  {/* Free plan — deliberately low-emphasis escape hatch: lets
                      the user into the app without checkout, with the free
                      limits spelled out so the choice is informed. */}
                  <div className="mt-8 border-t pt-6 text-center" style={{ borderColor: "var(--mk-rule)" }}>
                    <p className="text-sm font-medium text-foreground">
                      {t("paywall.freeOption.title")}
                    </p>
                    <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed max-w-md mx-auto">
                      {t("paywall.freeOption.limits")}
                    </p>
                    <Button
                      variant="ghost"
                      className="mt-3 h-10 rounded-lg px-5 text-[13px] text-muted-foreground hover:text-foreground"
                      onClick={handleContinueFree}
                      disabled={busy || freeBusy}
                    >
                      {freeBusy ? t("paywall.settingUp") : t("paywall.freeOption.continueButton")}
                    </Button>
                    <p className="mt-1 text-[11px] text-muted-foreground/80">
                      {t("paywall.freeOption.noCard")}
                    </p>
                  </div>
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
