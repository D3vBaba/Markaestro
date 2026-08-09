"use client";

import Link from "next/link";

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import PageHeader from "@/components/app/PageHeader";
import Select from "@/components/app/Select";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import AppLocaleSwitcher from "@/components/app/AppLocaleSwitcher";
import { apiDelete, apiGet, apiPost, apiPut, apiFetch } from "@/lib/api-client";
import { deferFromEffect } from "@/lib/defer-from-effect";
import { startOAuthAuthorize } from "@/lib/in-app-browser";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useAuth, friendlyAuthError } from "@/components/providers/AuthProvider";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { PLANS } from "@/lib/stripe/plans";
import type { PlanTier } from "@/lib/stripe/plans";
import { cn } from "@/lib/utils";
import { pillStyle } from "@/components/mk/pills";
import { resolveChannelStatus, type ChannelStatus } from "@/lib/integrations/channel-status";
import {
  User, Shield, Zap, Link2, Users, Building2, CreditCard,
  Pencil, Check, X, Loader2, KeyRound, Mail, BarChart3,
  Copy, Webhook, BookOpen, ExternalLink, Trash2, RefreshCw,
  Archive, ArchiveRestore,
} from "lucide-react";

type Member = {
  uid: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'analyst';
  joinedAt?: string;
};

type UsageMetric = { current: number; limit: number };

type ApiClientInfo = {
  id: string;
  name: string;
  scopes: string[];
  status: 'active' | 'revoked';
  archived?: boolean;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  productId?: string | null;
};

type ApiClientTrendPoint = {
  date: string;
  label: string;
  requests: number;
  queued: number;
  succeeded: number;
  actionRequired: number;
  failed: number;
};

type ApiClientUsage = ApiClientInfo & {
  usage: {
    totalRequests: number;
    currentMonth: string;
    currentMonthCounts: Record<string, number>;
  };
  trend: ApiClientTrendPoint[];
};

type ApiUsageTotals = {
  totalRequests: number;
  currentMonthRequests: number;
  publishQueued: number;
  publishSucceeded: number;
  publishActionRequired: number;
  publishFailed: number;
};

function formatShortDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

function apiErrorMessage(data: unknown, fallback: string) {
  const err = data as { message?: string; error?: string } | null | undefined;
  return err?.message || err?.error || fallback;
}

function formatMonthKey(monthKey: string, locale: string) {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString(locale, { month: "long", year: "numeric" });
}

function ApiTrendBars({ points, requestsLabel }: { points: ApiClientTrendPoint[]; requestsLabel: string }) {
  const max = Math.max(...points.map((point) => point.requests), 1);

  return (
    <div className="flex h-10 items-end gap-1">
      {points.map((point) => (
        <div key={point.date} className="flex-1">
          <div
            className="w-full rounded-t-sm bg-primary/60 transition-all"
            style={{ height: `${Math.max((point.requests / max) * 100, point.requests > 0 ? 10 : 2)}%` }}
            title={`${point.label}: ${point.requests} ${requestsLabel}`}
          />
        </div>
      ))}
    </div>
  );
}

type WebhookEndpointInfo = {
  id: string;
  url: string;
  events: string[];
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt?: string;
};

const API_SCOPE_OPTIONS = [
  { id: 'products.read', labelKey: 'productsRead' },
  { id: 'media.write', labelKey: 'mediaWrite' },
  { id: 'posts.read', labelKey: 'postsRead' },
  { id: 'posts.write', labelKey: 'postsWrite' },
  { id: 'posts.publish', labelKey: 'postsPublish' },
  { id: 'job_runs.read', labelKey: 'jobRunsRead' },
  { id: 'webhooks.manage', labelKey: 'webhooksManage' },
] as const;

const WEBHOOK_EVENT_OPTIONS = [
  { id: 'post.publish.queued', labelKey: 'postPublishQueued' },
  { id: 'post.published', labelKey: 'postPublished' },
  { id: 'post.action_required', labelKey: 'postActionRequired' },
  { id: 'post.failed', labelKey: 'postFailed' },
] as const;

const TABS = [
  { id: 'account', icon: User },
  { id: 'usage', icon: BarChart3 },
  { id: 'integrations', icon: Link2 },
  { id: 'team', icon: Users },
  { id: 'workspaces', icon: Building2 },
  { id: 'api', icon: KeyRound },
  { id: 'billing', icon: CreditCard },
] as const;
type Tab = typeof TABS[number]['id'];

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageContent />
    </Suspense>
  );
}

function SettingsPageContent() {
  const t = useTranslations("settings");
  const searchParams = useSearchParams();
  const rawTab = searchParams?.get('tab');
  const urlTab = TABS.find((tab) => tab.id === rawTab)?.id as Tab | undefined;
  const [activeTab, setActiveTab] = useState<Tab>(urlTab ?? 'account');

  // A ?tab= link has to win even when Settings is already on screen. Seeding
  // state at mount was not enough: "Manage workspaces" in the sidebar navigates
  // to /settings?tab=workspaces client-side, which updates the URL without
  // remounting this component, so the visible tab never changed and the link
  // looked dead. Re-sync whenever the param itself changes — adjusting state
  // during render (rather than in an effect) keeps it to a single pass.
  const [syncedUrlTab, setSyncedUrlTab] = useState(urlTab);
  if (urlTab !== syncedUrlTab) {
    setSyncedUrlTab(urlTab);
    // Ignore the param disappearing so in-page tab clicks are not undone.
    if (urlTab) setActiveTab(urlTab);
  }

  return (
    <AppShell>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {/* Tab bar */}
      <div
        className="flex gap-5 sm:gap-6 border-b mb-6 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0"
        style={{ borderColor: "var(--mk-rule-soft)" }}
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              data-tab={tab.id}
              className="flex items-center gap-1.5 py-3 sm:py-2.5 text-[13px] transition-colors -mb-px whitespace-nowrap shrink-0"
              style={{
                color: active ? "var(--mk-ink)" : "var(--mk-ink-60)",
                fontWeight: active ? 600 : 400,
                letterSpacing: "-0.005em",
                borderBottom: `2px solid ${active ? "var(--mk-ink)" : "transparent"}`,
              }}
            >
              <Icon
                className="h-3.5 w-3.5"
                style={{ color: active ? "var(--mk-ink)" : "var(--mk-ink-60)" }}
              />
              {t(`tabs.${tab.id}`)}
            </button>
          );
        })}
      </div>

      {activeTab === 'account' && <AccountTab />}
      {activeTab === 'usage' && <UsageTab onUpgrade={() => setActiveTab('billing')} />}
      {activeTab === 'integrations' && <IntegrationsTab />}
      {activeTab === 'team' && <TeamTab />}
      {activeTab === 'workspaces' && <WorkspacesTab />}
      {activeTab === 'api' && <ApiAccessTab />}
      {activeTab === 'billing' && <BillingTab />}
    </AppShell>
  );
}

/* ─── Account Tab ──────────────────────────────────────────────────────────── */

function AccountTab() {
  const t = useTranslations("settings.account");
  const tAuthErrors = useTranslations("appCommon.authErrors");
  const { user, requestEmailChangeCode, confirmEmailChangeCode, logout } = useAuth();
  const { current: workspace } = useWorkspace();
  const [changingEmail, setChangingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [pendingEmailChange, setPendingEmailChange] = useState<string | null>(null);
  const [emailChangeCode, setEmailChangeCode] = useState('');
  const [confirmingEmailChange, setConfirmingEmailChange] = useState(false);
  const [resendingEmailChange, setResendingEmailChange] = useState(false);

  if (!user) return null;

  const displayName = user.displayName || user.email?.split("@")[0] || "User";
  const email = user.email || "";
  const initials = displayName.slice(0, 2).toUpperCase();

  // Sign-in method badges. Code sign-ins mint custom tokens, which leave
  // providerData empty — that IS the email-code method.
  const providers = (user.providerData ?? [])
    .map((p) => {
      if (p.providerId === "password") return t("profile.providerEmailCode");
      if (p.providerId === "google.com") return t("profile.providerGoogle");
      if (p.providerId === "facebook.com") return t("profile.providerFacebook");
      return p.providerId;
    })
    .filter((label, i, arr) => arr.indexOf(label) === i);
  if (providers.length === 0) providers.push(t("profile.providerEmailCode"));
  const isEmailCodeLabel = (label: string) => label === t("profile.providerEmailCode");
  const isGoogleLabel = (label: string) => label === t("profile.providerGoogle");

  // Google accounts keep their email in sync with Google — changing it here
  // would desync the two, so only offer it to email-based accounts.
  const canChangeEmail = !user.providerData?.some((p) => p.providerId === "google.com");

  async function handleEmailChange() {
    const candidate = newEmail.trim().toLowerCase();
    if (!candidate) return;
    setChangingEmail(true);
    try {
      await requestEmailChangeCode(candidate);
      toast.success(t("toasts.codeSent"));
      setPendingEmailChange(candidate);
      setEmailChangeCode('');
      setNewEmail('');
    } catch (e: unknown) {
      toast.error(friendlyAuthError(e, tAuthErrors));
    } finally {
      setChangingEmail(false);
    }
  }

  async function handleConfirmEmailChange() {
    if (!pendingEmailChange || emailChangeCode.length < 6) return;
    setConfirmingEmailChange(true);
    try {
      await confirmEmailChangeCode(pendingEmailChange, emailChangeCode);
      toast.success(t("toasts.emailUpdated"));
      setPendingEmailChange(null);
      setEmailChangeCode('');
    } catch (e: unknown) {
      toast.error(friendlyAuthError(e, tAuthErrors));
    } finally {
      setConfirmingEmailChange(false);
    }
  }

  async function handleResendEmailChange() {
    if (!pendingEmailChange) return;
    setResendingEmailChange(true);
    try {
      await requestEmailChangeCode(pendingEmailChange);
      toast.success(t("toasts.codeResent"));
    } catch (e: unknown) {
      toast.error(friendlyAuthError(e, tAuthErrors));
    } finally {
      setResendingEmailChange(false);
    }
  }

  return (
    <div className="grid gap-5">
      {/* Profile */}
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle>{t("profile.title")}</CardTitle>
          <CardDescription>{t("profile.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-4">
            {/* Avatar */}
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={displayName}
                className="h-14 w-14 rounded-full object-cover border"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-lg font-bold text-primary">{initials}</span>
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <p className="text-sm font-medium">{displayName}</p>
                <p className="text-sm text-muted-foreground">{email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {providers.map((p) => (
                  <Badge key={p} variant="outline" className="text-xs font-normal">
                    {isEmailCodeLabel(p) ? <KeyRound className="h-3 w-3 me-1" /> : null}
                    {isGoogleLabel(p) ? <Mail className="h-3 w-3 me-1" /> : null}
                    {p}
                  </Badge>
                ))}
                {workspace && (
                  <Badge className="bg-primary/10 text-primary border-0 text-xs font-normal capitalize">
                    {workspace.role}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Language */}
      <Card className="border-border/30">
        <CardContent className="pt-6">
          <AppLocaleSwitcher />
        </CardContent>
      </Card>

      {/* Security */}
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            {t("security.title")}
          </CardTitle>
          <CardDescription>{t("security.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border p-4">
            <p className="text-sm font-medium">{t("security.passwordlessTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {t("security.passwordlessDescription")}
            </p>
          </div>

          {canChangeEmail && (
            <div className="rounded-xl border p-4 space-y-3">
              <div>
                <p className="text-sm font-medium">{t("security.changeEmailTitle")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("security.changeEmailDescription")}
                </p>
              </div>
              {pendingEmailChange ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full px-2.5 py-1 text-xs break-all" style={pillStyle("warn")}>
                      {t("security.codeSentTo", { email: pendingEmailChange })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handleResendEmailChange}
                      disabled={resendingEmailChange}
                    >
                      {resendingEmailChange ? t("security.resending") : t("security.resend")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => { setPendingEmailChange(null); setEmailChangeCode(''); }}
                    >
                      {t("security.cancel")}
                    </Button>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Input
                      value={emailChangeCode}
                      onChange={(e) => setEmailChangeCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      className="h-10 rounded-xl text-center font-mono tracking-[0.3em] sm:max-w-[160px]"
                      onKeyDown={(e) => e.key === 'Enter' && handleConfirmEmailChange()}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 h-10"
                      onClick={handleConfirmEmailChange}
                      disabled={confirmingEmailChange || emailChangeCode.length < 6}
                    >
                      {confirmingEmailChange ? t("security.confirming") : t("security.confirmChange")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-3">
                  <Input
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder={t("security.newEmailPlaceholder")}
                    type="email"
                    className="h-10 rounded-xl"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 h-10"
                    onClick={handleEmailChange}
                    disabled={changingEmail || !newEmail.trim()}
                  >
                    {changingEmail ? t("security.sending") : t("security.sendCode")}
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t("security.signOutTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("security.signOutDescription")}
              </p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={logout}>
              {t("security.signOut")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/20">
        <CardHeader>
          <CardTitle className="text-destructive">{t("dangerZone.title")}</CardTitle>
          <CardDescription>{t("dangerZone.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-destructive/20 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t("dangerZone.deleteTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("dangerZone.deleteDescription")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("dangerZone.deleteHandledBy")}{" "}
                <Link href="/contact" className="text-primary hover:underline">{t("dangerZone.contactUs")}</Link>.
              </p>
            </div>
            <Button variant="destructive" size="sm" className="shrink-0" disabled>
              {t("dangerZone.deleteAccount")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Usage Tab ────────────────────────────────────────────────────────────── */

function UsageMeter({
  label,
  current,
  limit,
  unit,
  locale,
}: {
  label: string;
  current: number;
  limit: number;
  unit?: string;
  locale: string;
}) {
  const t = useTranslations("settings.usage");
  const unlimited = limit === -1;
  const unavailable = limit === 0;
  const pct = unlimited ? 0 : unavailable ? 0 : Math.min((current / limit) * 100, 100);
  const isHigh = pct >= 80;
  const isFull = pct >= 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        <p
          className="text-sm tabular-nums"
          style={{
            color: isFull
              ? "var(--mk-neg)"
              : isHigh
              ? "var(--mk-warn)"
              : "var(--mk-ink-60)",
            fontWeight: isFull ? 500 : 400,
          }}
        >
          {unavailable ? (
            <span className="text-muted-foreground">{t("notAvailable")}</span>
          ) : unlimited ? (
            unit ? t("usedWithUnit", { count: current.toLocaleString(locale), unit }) : t("used", { count: current.toLocaleString(locale) })
          ) : (
            unit
              ? t("usedOfWithUnit", { current: current.toLocaleString(locale), limit: limit.toLocaleString(locale), unit })
              : t("usedOf", { current: current.toLocaleString(locale), limit: limit.toLocaleString(locale) })
          )}
        </p>
      </div>
      {!unavailable && !unlimited && (
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: isFull
                ? "var(--mk-neg)"
                : isHigh
                ? "var(--mk-warn)"
                : "var(--mk-accent)",
            }}
          />
        </div>
      )}
      {unlimited && (
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full w-[15%]"
            style={{ background: "var(--mk-pos)" }}
          />
        </div>
      )}
    </div>
  );
}

function UsageTab({ onUpgrade }: { onUpgrade: () => void }) {
  const t = useTranslations("settings.usage");
  const locale = useLocale();
  const { status } = useSubscription();
  const { data: usageData, loading } = useApiQuery<{
    usage: {
      mediaUploads: UsageMetric;
      channels: UsageMetric;
      products: { current: number };
    };
    tier: string;
    plan: string;
  }>("/api/usage");
  const usage = usageData?.usage ?? null;

  const tier = (status?.tier ?? 'starter') as PlanTier;
  const plan = PLANS[tier];

  if (loading) {
    return (
      <div className="grid gap-5">
        <Card className="border-border/30">
          <CardHeader>
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-56" />
          </CardHeader>
          <CardContent className="space-y-5">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-2">
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
            <Skeleton className="h-4 w-48" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const month = new Date().toLocaleDateString(locale, { month: "long", year: "numeric" });

  return (
    <div className="grid gap-5">
      <Card className="border-border/30">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-4 w-4" />
                {t("title")}
              </CardTitle>
              <CardDescription>{month} · {plan.name}</CardDescription>
            </div>
            {status?.trialing && (
              <Badge className="bg-primary/10 text-primary border-0">{t("trial")}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Media uploads */}
          <UsageMeter
            label={t("mediaUploads")}
            current={usage?.mediaUploads.current ?? 0}
            limit={usage?.mediaUploads.limit ?? plan.limits.mediaUploads}
            locale={locale}
          />

          {/* Channels */}
          <UsageMeter
            label={t("connectedChannels")}
            current={usage?.channels.current ?? 0}
            limit={usage?.channels.limit ?? plan.limits.channels}
            locale={locale}
          />

          {/* Products */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-sm font-medium">{t("brandsRegistered")}</p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {usage?.products.current ?? 0}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Plan limits summary */}
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle>{t("planLimitsTitle")}</CardTitle>
          <CardDescription>{t("planLimitsDescription", { plan: plan.name })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
            {plan.features.map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm">
                <Check className="h-3.5 w-3.5 text-mk-pos shrink-0" />
                <span className="text-muted-foreground">{f}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t">
            <Button variant="outline" size="sm" onClick={onUpgrade}>
              {t("upgradePlan")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Integrations Tab ──────────────────────────────────────────────────── */

// Each product links its own individual account per channel — nothing is shared
// across products, and Facebook and Instagram are separate links.
const PRODUCT_CHANNELS: { provider: string; channelKey: string }[] = [
  { provider: "meta", channelKey: "meta" },
  { provider: "instagram", channelKey: "instagram" },
  { provider: "tiktok", channelKey: "tiktok" },
  { provider: "threads", channelKey: "threads" },
  { provider: "pinterest", channelKey: "pinterest" },
  { provider: "linkedin", channelKey: "linkedin" },
];

/** One linked account/Page/board for a channel. */
type ConnAccount = {
  connectionId: string;
  destinationId?: string | null;
  label?: string | null;
  status?: string;
  enabled?: boolean;
};

type ConnEntry = {
  provider: string;
  accounts?: ConnAccount[];
  scope?: "workspace" | "product";
  status?: string;
  pageId?: string | null;
  pageName?: string | null;
  igAccountId?: string | null;
  username?: string | null;
  boardId?: string | null;
  boardName?: string | null;
  boardSelectionRequired?: boolean;
  linkedinDestinationUrn?: string | null;
  linkedinDestinationName?: string | null;
  linkedinDestinationType?: "profile" | "page" | null;
  linkedinDestinationSelectionRequired?: boolean;
  linkedinProfileConnected?: boolean;
  linkedinCommunityConnected?: boolean;
  pageSelectionRequired?: boolean;
  needsPageSelection?: boolean;
};

type MetaPage = { id: string; name: string; hasInstagram: boolean; igAccountId: string | null; accountId?: string | null; accountLabel?: string | null };

const MANUAL_POSTING_CHANNELS = [
  { id: "instagram" },
  { id: "facebook" },
  { id: "tiktok" },
  { id: "threads" },
  { id: "linkedin" },
  { id: "pinterest" },
] as const;

/**
 * Workspace default: channels switched on here publish via the manual
 * "To Post" queue — Markaestro never calls the platform's API for them,
 * and the user posts natively from a reminder instead.
 */
function ManualPostingCard() {
  const t = useTranslations("settings.manualPosting");
  const tChannels = useTranslations("settings.integrations.manualChannels");
  const { current: workspace } = useWorkspace();
  const wsId = workspace?.id ?? "default";
  const canManage = workspace?.role === "owner" || workspace?.role === "admin";

  const { data, loading, refresh } = useApiQuery<{ manualPublishChannels: string[] }>(
    "/api/settings/publishing",
    { wsId },
  );
  const [savingChannel, setSavingChannel] = useState<string | null>(null);
  const enabled = new Set(data?.manualPublishChannels ?? []);

  const toggleChannel = async (channel: string) => {
    if (savingChannel || loading) return;
    const next = enabled.has(channel)
      ? [...enabled].filter((c) => c !== channel)
      : [...enabled, channel];

    setSavingChannel(channel);
    try {
      const res = await apiPut<{ manualPublishChannels?: string[]; error?: string }>(
        "/api/settings/publishing",
        { manualPublishChannels: next },
        wsId,
      );
      if (res.ok) {
        refresh();
      } else {
        toast.error(t("updateFailed"));
      }
    } finally {
      setSavingChannel(null);
    }
  };

  return (
    <Card className="border-border/30">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          {t("description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {MANUAL_POSTING_CHANNELS.map((channel) => (
          <div key={channel.id} className="flex items-center justify-between gap-3 rounded-xl border p-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{tChannels(channel.id)}</p>
              <p className="text-xs text-muted-foreground">
                {enabled.has(channel.id)
                  ? t("manualStatus")
                  : t("automatedStatus")}
              </p>
            </div>
            <Switch
              checked={enabled.has(channel.id)}
              disabled={!canManage || loading || savingChannel === channel.id}
              onCheckedChange={() => toggleChannel(channel.id)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function IntegrationsTab() {
  const t = useTranslations("settings.integrations");
  const { current: workspace } = useWorkspace();
  const wsId = workspace?.id ?? "default";

  const { data: productsData, loading: productsLoading } = useApiQuery<{
    products: { id: string; name: string }[];
  }>("/api/products", { wsId });
  const products = productsData?.products ?? [];
  const productIds = products.map((p) => p.id).join(",");

  const {
    data: connData,
    loading: connLoading,
    refresh: refreshConns,
  } = useApiQuery<{ products: Record<string, ConnEntry[]> }>(
    productIds ? `/api/integrations?productIds=${productIds}` : null,
    { wsId },
  );
  const connsByProduct = connData?.products ?? {};

  const [busy, setBusy] = useState<string | null>(null); // `${productId}:${provider}`
  const [disconnectTarget, setDisconnectTarget] = useState<{ productId: string; provider: string; label: string } | null>(null);

  // Meta page picker (multiple Facebook Pages → pick one for this product).
  const [pagePickerProduct, setPagePickerProduct] = useState<string | null>(null);
  const [pages, setPages] = useState<MetaPage[] | null>(null);
  const [linkedPageIds, setLinkedPageIds] = useState<string[]>([]);
  const [pagesError, setPagesError] = useState("");
  const [selectingPage, setSelectingPage] = useState<string | null>(null);

  function providerDisplayName(provider: string): string {
    if (provider === "meta") return "Meta";
    if (provider === "linkedin") return "LinkedIn";
    return provider;
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("oauth");
    const provider = params.get("provider");
    const productId = params.get("productId");
    const needsPageSelect = params.get("needsPageSelect");

    if (oauth === "success" && provider) {
      toast.success(t("toasts.connected", { provider: providerDisplayName(provider) }));
      window.history.replaceState({}, "", "/settings?tab=integrations");
      const timer = setTimeout(() => invalidateQueries("/api/integrations"), 500);
      if (needsPageSelect === "1" && provider === "meta" && productId) {
        deferFromEffect(() => setPagePickerProduct(productId));
      }
      return () => clearTimeout(timer);
    }
    if (oauth === "error" && provider) {
      const message = params.get("message");
      toast.error(
        message
          ? t("toasts.connectFailedWithMessage", { provider: providerDisplayName(provider), message })
          : t("toasts.connectFailed", { provider: providerDisplayName(provider) }),
      );
      window.history.replaceState({}, "", "/settings?tab=integrations");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the user's Facebook Pages when the picker opens.
  useEffect(() => {
    if (!pagePickerProduct) return;
    let cancelled = false;
    (async () => {
      setPages(null);
      setPagesError("");
      const res = await apiGet<{ pages?: MetaPage[]; linkedIds?: string[]; error?: string }>(
        `/api/oauth/pages/meta?productId=${encodeURIComponent(pagePickerProduct)}`,
        wsId,
      );
      if (cancelled) return;
      if (!res.ok) {
        setPages([]);
        setPagesError(res.data?.error || t("pagePicker.noneFound"));
        return;
      }
      setPages(res.data.pages || []);
      setLinkedPageIds(res.data.linkedIds || []);
      if (res.data.error) setPagesError(res.data.error);
    })();
    return () => { cancelled = true; };
  }, [pagePickerProduct, wsId, t]);

  function connect(provider: string, productId: string, linkedinMode?: "profile" | "community") {
    const qs = new URLSearchParams({
      productId,
      returnTo: "/settings?tab=integrations",
    });
    if (provider === "linkedin" && linkedinMode) {
      qs.set("linkedinMode", linkedinMode);
    }
    startOAuthAuthorize(`/api/oauth/authorize/${provider}?${qs.toString()}`);
  }

  async function confirmDisconnect() {
    if (!disconnectTarget) return;
    const { productId, provider, label } = disconnectTarget;
    setBusy(`${productId}:${provider}`);
    try {
      const res = await apiPost(`/api/oauth/disconnect/${provider}`, { productId }, wsId);
      if (res.ok) {
        toast.success(t("toasts.unlinked", { label }));
        refreshConns();
      } else {
        toast.error(t("toasts.unlinkFailed"));
      }
    } catch {
      toast.error(t("toasts.somethingWrong"));
    } finally {
      setBusy(null);
      setDisconnectTarget(null);
    }
  }

  async function selectPage(page: MetaPage) {
    if (!pagePickerProduct) return;
    setSelectingPage(page.id);
    try {
      const res = await apiPost(
        "/api/oauth/pages/meta/select",
        { pageId: page.id, pageName: page.name, productId: pagePickerProduct },
        wsId,
      );
      if (res.ok) {
        toast.success(t("toasts.linkedPage", { name: page.name }));
        setLinkedPageIds((prev) => [...new Set([...prev, page.id])]);
        refreshConns();
      } else {
        toast.error(t("toasts.linkPageFailed"));
      }
    } catch {
      toast.error(t("toasts.somethingWrong"));
    } finally {
      setSelectingPage(null);
    }
  }

  function channelStatus(productId: string, provider: string): ChannelStatus {
    const entry = (connsByProduct[productId] || []).find((c) => c.provider === provider);
    return resolveChannelStatus(provider, entry);
  }

  /** The individual accounts/Pages linked for a channel on a brand. */
  function channelAccounts(productId: string, provider: string) {
    const entry = (connsByProduct[productId] || []).find((c) => c.provider === provider);
    return (entry?.accounts ?? []).filter((account) => account.destinationId);
  }

  // Unlink one Page/account, leaving the brand's other accounts on that
  // platform — and every other brand — untouched.
  async function unlinkAccount(
    productId: string,
    provider: string,
    destinationId: string,
    label: string,
  ) {
    setBusy(`${productId}:${provider}:${destinationId}`);
    try {
      const res = await apiPost(
        `/api/oauth/disconnect/${provider}`,
        { productId, destinationId },
        wsId,
      );
      if (res.ok) {
        toast.success(t("toasts.unlinked", { label }));
        refreshConns();
      } else {
        toast.error(t("toasts.unlinkFailedLabel", { label }));
      }
    } catch {
      toast.error(t("toasts.somethingWrong"));
    } finally {
      setBusy(null);
    }
  }

  if (productsLoading || (!!productIds && connLoading && !connData)) {
    return (
      <div className="grid gap-5">
        {[0, 1].map((i) => (
          <Card key={i} className="border-border/30">
            <CardHeader><Skeleton className="h-5 w-48" /></CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle>{t("noProductsTitle")}</CardTitle>
          <CardDescription>{t("noProductsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/products"><Button>{t("createBrand")}</Button></Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-5">
      <ManualPostingCard />

      <p className="text-sm text-muted-foreground">
        {t("linkDescription")}
      </p>

      {products.map((product) => (
        <Card key={product.id} className="border-border/30">
          <CardHeader>
            <CardTitle>{product.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {PRODUCT_CHANNELS.map((ch) => {
              const st = channelStatus(product.id, ch.provider);
              const isBusy = busy === `${product.id}:${ch.provider}`;
              const accounts = channelAccounts(product.id, ch.provider);
              const channelLabel = t(`channels.${ch.channelKey}.label`);
              return (
                <div key={ch.provider} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{channelLabel}</p>
                      {st.state === "connected" && <Badge className="border-0" style={pillStyle("pos")}>{t("linked")}</Badge>}
                      {st.state === "needs-page" && (
                        <Badge className="border-0" style={pillStyle("warn")}>
                          {ch.provider === "pinterest" ? t("pickBoard") : ch.provider === "linkedin" ? t("pickTarget") : t("pickPage")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {st.state === "connected" ? (st.label || t("linkedAndReady")) : t(`channels.${ch.channelKey}.sub`)}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {st.state === "connected" ? (
                      <div className="flex gap-2">
                        {ch.provider === "meta" && (
                          <Button size="sm" onClick={() => setPagePickerProduct(product.id)}>
                            {t("addPage")}
                          </Button>
                        )}
                        {/* Reconnect re-runs OAuth in place. Unlinking first is
                            never required and would drop this brand's Pages. */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => connect(ch.provider, product.id)}
                        >
                          {ch.provider === "meta" ? t("reconnectAddAccount") : t("reconnect")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => setDisconnectTarget({ productId: product.id, provider: ch.provider, label: `${channelLabel} · ${product.name}` })}
                        >
                          {isBusy ? t("unlinking") : accounts.length > 1 ? t("unlinkAll") : t("unlink")}
                        </Button>
                      </div>
                    ) : st.state === "needs-page" ? (
                      ch.provider === "pinterest" ? (
                        <Link href="/products"><Button size="sm">{t("chooseBoard")}</Button></Link>
                      ) : ch.provider === "linkedin" ? (
                        <Link href="/products"><Button size="sm">{t("chooseTarget")}</Button></Link>
                      ) : (
                        <Button size="sm" onClick={() => setPagePickerProduct(product.id)}>{t("choosePage")}</Button>
                      )
                    ) : ch.provider === "linkedin" ? (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => connect(ch.provider, product.id, "profile")}>{t("profileButton")}</Button>
                        <Button size="sm" variant="outline" onClick={() => connect(ch.provider, product.id, "community")}>{t("pagesButton")}</Button>
                      </div>
                    ) : (
                      <Button size="sm" onClick={() => connect(ch.provider, product.id)}>{t("link")}</Button>
                    )}
                  </div>
                  {accounts.length > 0 && (
                    <div className="w-full space-y-1.5">
                      {accounts.map((account) => {
                        const label = account.label || account.destinationId || t("linkedAccountFallback");
                        const accountBusy = busy === `${product.id}:${ch.provider}:${account.destinationId}`;
                        return (
                          <div
                            key={account.connectionId}
                            className="flex items-center gap-2 rounded-lg border border-border/40 px-2.5 py-1.5"
                          >
                            <span className="min-w-0 flex-1 truncate text-[12px]">{label}</span>
                            {account.enabled === false && (
                              <Badge className="border-0 text-[10px] shrink-0" style={pillStyle("warn")}>
                                {account.status === "revoked" ? t("reconnect") : account.status}
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              disabled={accountBusy}
                              onClick={() => unlinkAccount(product.id, ch.provider, account.destinationId!, label)}
                            >
                              {accountBusy ? "…" : t("unlink")}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {/* Meta Facebook Page picker */}
      <Dialog open={!!pagePickerProduct} onOpenChange={(open) => { if (!open) setPagePickerProduct(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("pagePicker.title")}</DialogTitle>
            <DialogDescription>
              {t("pagePicker.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {pages === null ? (
              <>
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </>
            ) : pagesError && pages.length === 0 ? (
              <p className="text-sm text-mk-warn">{pagesError}</p>
            ) : pages.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("pagePicker.noneFound")}</p>
            ) : (
              pages.map((pg) => (
                <button
                  key={pg.id}
                  type="button"
                  disabled={!!selectingPage || linkedPageIds.includes(pg.id)}
                  onClick={() => selectPage(pg)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-start transition-colors hover:border-primary/50 disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{pg.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {pg.accountLabel ? `via ${pg.accountLabel}` : t("channels.meta.label")}
                    </p>
                  </div>
                  <span className="text-xs text-primary shrink-0">
                    {linkedPageIds.includes(pg.id)
                      ? t("linked")
                      : selectingPage === pg.id
                      ? t("pagePicker.linking")
                      : t("link")}
                  </span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!disconnectTarget}
        onOpenChange={(open) => { if (!open) setDisconnectTarget(null); }}
        entity="connection"
        name={disconnectTarget?.label}
        confirmLabel={t("disconnectDialog.confirmLabel")}
        warning={t("disconnectDialog.warning")}
        onConfirm={confirmDisconnect}
      />
    </div>
  );
}

/* ─── Team Tab ──────────────────────────────────────────────────────────── */

function TeamTab() {
  const t = useTranslations("settings.team");
  const { status } = useSubscription();
  const { current: workspace } = useWorkspace();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteEmailError, setInviteEmailError] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'analyst'>('member');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ uid: string; email: string } | null>(null);

  const wsId = workspace?.id ?? 'default';
  const tier = (status?.tier ?? 'starter') as PlanTier;
  const plan = PLANS[tier];
  const limit = plan.limits.teamMembers;
  const canInvite = workspace?.role === 'owner' || workspace?.role === 'admin';

  const {
    data: membersData,
    loading: membersLoading,
    refresh: fetchMembers,
  } = useApiQuery<{ members: Member[] }>('/api/team', { wsId });
  const members = membersData?.members ?? [];

  async function invite() {
    const candidate = inviteEmail.trim();
    if (!candidate) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
      setInviteEmailError(t("toasts.invalidEmail"));
      return;
    }
    setInviteEmailError(null);
    setInviting(true);
    try {
      const res = await apiPost<{ status: string; email: string }>('/api/team', { email: candidate, role: inviteRole }, wsId);
      if (res.ok) {
        const s = res.data.status;
        if (s === 'pending') toast.success(t("toasts.inviteSent", { email: res.data.email }));
        else if (s === 'already_owner') toast.info(t("toasts.alreadyOwner", { email: inviteEmail }));
        else toast.success(t("toasts.addedAs", { email: inviteEmail, role: t(`roleLabels.${inviteRole}`) }));
        setInviteEmail('');
        fetchMembers();
      } else {
        const err = (res.data as { error?: string }).error;
        if (err === 'TEAM_LIMIT_REACHED') toast.error(t("toasts.limitReached", { plan: plan.name, limit }));
        else toast.error(t("toasts.inviteFailed"));
      }
    } catch {
      toast.error(t("toasts.somethingWrong"));
    } finally {
      setInviting(false);
    }
  }

  async function confirmRemoveMember() {
    if (!removeTarget) return;
    setRemoving(removeTarget.uid);
    try {
      const res = await apiFetch(`/api/team/${removeTarget.uid}?workspaceId=${wsId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(t("toasts.memberRemoved"));
        fetchMembers();
      } else {
        toast.error(t("toasts.removeFailed"));
      }
    } catch {
      toast.error(t("toasts.somethingWrongRemove"));
    } finally {
      setRemoving(null);
    }
  }

  const roleDescriptions: Record<string, string> = {
    owner: t("roles.owner"),
    admin: t("roles.admin"),
    member: t("roles.member"),
    analyst: t("roles.analyst"),
  };

  return (
    <div className="grid gap-5">
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle>{t("membersTitle")}</CardTitle>
          <CardDescription>
            {limit === -1
              ? t("unlimitedMembers", { plan: plan.name })
              : t("memberCount", { count: membersLoading ? "…" : members.length, limit, plan: plan.name })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Member list */}
          <div className="rounded-xl border divide-y divide-border/40">
            {membersLoading && (
              <>
                {[0, 1].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </div>
                ))}
              </>
            )}
            {!membersLoading && members.length === 0 && (
              <p className="text-sm text-muted-foreground px-4 py-3">{t("noMembers")}</p>
            )}
            {members.map((m) => (
              <div key={m.uid} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <span className="text-xs font-semibold text-muted-foreground">
                      {m.email.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{m.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(`roleLabels.${m.role}`)}
                      {roleDescriptions[m.role] ? ` — ${roleDescriptions[m.role]}` : ""}
                    </p>
                  </div>
                </div>
                {canInvite && m.role !== 'owner' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-mk-neg shrink-0"
                    onClick={() => setRemoveTarget({ uid: m.uid, email: m.email })}
                    disabled={removing === m.uid}
                  >
                    {removing === m.uid ? t("removing") : t("remove")}
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Invite form */}
          {canInvite && (limit === -1 || members.length < limit) && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{t("inviteLabel")}</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  value={inviteEmail}
                  onChange={(e) => { setInviteEmail(e.target.value); if (inviteEmailError) setInviteEmailError(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && invite()}
                  className="flex-1"
                />
                <div className="sm:w-32">
                  <Select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member' | 'analyst')}
                  >
                    <option value="member">{t("roleLabels.member")}</option>
                    <option value="analyst">{t("roleLabels.analyst")}</option>
                    <option value="admin">{t("roleLabels.admin")}</option>
                  </Select>
                </div>
                <Button onClick={invite} disabled={inviting || !inviteEmail.trim()}>
                  {inviting ? t("inviting") : t("invite")}
                </Button>
              </div>
              {inviteEmailError && (
                <p className="text-xs text-mk-neg">{inviteEmailError}</p>
              )}
            </div>
          )}

          {canInvite && limit !== -1 && members.length >= limit && (
            <p className="text-xs text-muted-foreground pt-1">
              {t("limitReached")}{' '}
              <Link href="/settings?tab=billing" className="text-primary hover:underline">{t("upgradePlan")}</Link> {t("toInviteMore")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Roles reference */}
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle>{t("roles.title")}</CardTitle>
          <CardDescription>{t("roles.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-3">
            {(["owner", "admin", "member", "analyst"] as const).map((role) => (
              <div key={role} className="rounded-lg border p-3">
                <p className="text-sm font-medium">{t(`roleLabels.${role}`)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{roleDescriptions[role]}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <ConfirmDeleteDialog
        open={!!removeTarget}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
        entity="teamMember"
        name={removeTarget?.email}
        confirmLabel={t("removeDialog.confirmLabel")}
        warning={t("removeDialog.warning")}
        onConfirm={confirmRemoveMember}
      />
    </div>
  );
}

/* ─── Workspaces Tab ────────────────────────────────────────────────────── */

function WorkspacesTab() {
  const t = useTranslations("settings.workspaces");
  const { status } = useSubscription();
  const { workspaces, current, switchWorkspace, refresh } = useWorkspace();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const tier = (status?.tier ?? 'starter') as PlanTier;
  const plan = PLANS[tier];
  const limit = plan.limits.workspaces;
  const ownedCount = workspaces.filter((w) => w.role === 'owner').length;
  const canCreate = limit === -1 || ownedCount < limit;

  async function createWorkspace() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch<{ id: string; name: string }>('/api/workspaces?workspaceId=default', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        toast.success(t("toasts.created", { name: newName.trim() }));
        setNewName('');
        await refresh();
        switchWorkspace(res.data.id);
      } else {
        const err = (res.data as { error?: string }).error;
        if (err === 'WORKSPACE_LIMIT_REACHED') {
          toast.error(t("toasts.limitReachedError", { plan: plan.name, limit }));
        } else {
          toast.error(t("toasts.createFailed"));
        }
      }
    } catch {
      toast.error(t("toasts.somethingWrong"));
    } finally {
      setCreating(false);
    }
  }

  async function renameWorkspace(id: string) {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const res = await apiPut(`/api/workspaces/${id}`, { name: editName.trim() });
      if (res.ok) {
        toast.success(t("toasts.renamed"));
        setEditingId(null);
        await refresh();
      } else {
        toast.error(t("toasts.renameFailed"));
      }
    } catch {
      toast.error(t("toasts.somethingWrong"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>
            {limit === -1
              ? t("unlimitedWorkspaces", { plan: plan.name })
              : t("ownedCount", { count: ownedCount, limit, plan: plan.name })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Workspace list */}
          <div className="rounded-xl border divide-y divide-border/40">
            {workspaces.map((ws) => (
              <div key={ws.id} className="flex items-center gap-3 px-4 py-3">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-primary">{ws.name.slice(0, 2).toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  {editingId === ws.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') renameWorkspace(ws.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="h-8 text-sm"
                        autoFocus
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => renameWorkspace(ws.id)}
                        disabled={saving}
                      >
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium truncate">{ws.name}</p>
                        {ws.role === 'owner' && (
                          <button
                            className="text-muted-foreground hover:text-foreground transition-colors p-2 -m-1 grid place-items-center"
                            onClick={() => { setEditingId(ws.id); setEditName(ws.name); }}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{t(`roleLabels.${ws.role}`)}</p>
                    </>
                  )}
                </div>
                {ws.id === current?.id ? (
                  <Badge className="bg-primary/10 text-primary border-0 shrink-0">{t("active")}</Badge>
                ) : (
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => switchWorkspace(ws.id)}>
                    {t("switch")}
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Create workspace */}
          {canCreate && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{t("createLabel")}</p>
              <div className="flex gap-2">
                <Input
                  placeholder={t("namePlaceholder")}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createWorkspace()}
                  className="flex-1"
                />
                <Button onClick={createWorkspace} disabled={creating || !newName.trim()}>
                  {creating ? t("creating") : t("create")}
                </Button>
              </div>
            </div>
          )}

          {!canCreate && (
            <p className="text-xs text-muted-foreground pt-1">
              {t("limitReached")}{' '}
              <Link href="/settings?tab=billing" className="text-primary hover:underline">{t("upgradePlan")}</Link> {t("toCreateMore")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── API Access Tab ───────────────────────────────────────────────────── */

function ApiAccessTab() {
  const t = useTranslations("settings.api");
  const locale = useLocale();
  // Sampled once per mount rather than read during render: an API key's
  // expired/active badge must not depend on when React happened to re-render.
  const [nowAtMount] = useState(() => Date.now());
  const { current: workspace } = useWorkspace();
  const wsId = workspace?.id ?? 'default';
  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin';

  const {
    data: webhooksData,
    loading: webhooksLoading,
    refresh: refreshWebhooks,
  } = useApiQuery<{ webhookEndpoints: WebhookEndpointInfo[] }>(
    canManage ? '/api/settings/webhook-endpoints' : null,
    { wsId },
  );
  const {
    data: usageData,
    loading: usageLoading,
    refresh: refreshUsage,
  } = useApiQuery<{ clients: ApiClientUsage[]; totals: ApiUsageTotals }>(
    canManage ? '/api/settings/api-clients/usage' : null,
    { wsId },
  );
  const { data: productsData } = useApiQuery<{ products: { id: string; name: string }[] }>(
    canManage ? '/api/products' : null,
    { wsId },
  );
  const products = productsData?.products ?? [];
  const productNameById = (id: string | null | undefined) =>
    id ? products.find((p) => p.id === id)?.name ?? id : null;
  const webhookEndpoints = webhooksData?.webhookEndpoints ?? [];
  const apiClientUsage = usageData?.clients ?? [];
  const usageTotals: ApiUsageTotals = usageData?.totals ?? {
    totalRequests: 0,
    currentMonthRequests: 0,
    publishQueued: 0,
    publishSucceeded: 0,
    publishActionRequired: 0,
    publishFailed: 0,
  };
  const loading = webhooksLoading || usageLoading;

  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [createWebhookOpen, setCreateWebhookOpen] = useState(false);
  const [editKeyOpen, setEditKeyOpen] = useState(false);

  const [clientName, setClientName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['products.read', 'media.write', 'posts.write', 'posts.publish', 'job_runs.read']);
  const [expiresInDays, setExpiresInDays] = useState<'never' | '30' | '90' | '365'>('never');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [editingClient, setEditingClient] = useState<ApiClientInfo | null>(null);
  const [editingScopes, setEditingScopes] = useState<string[]>([]);
  const [creatingClient, setCreatingClient] = useState(false);
  const [savingClientScopes, setSavingClientScopes] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [createdKeyMode, setCreatedKeyMode] = useState<'created' | 'rotated'>('created');
  const [rotateTarget, setRotateTarget] = useState<ApiClientInfo | null>(null);
  const [rotatingClient, setRotatingClient] = useState(false);

  const [webhookUrl, setWebhookUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['post.published', 'post.action_required', 'post.failed']);
  const [creatingWebhook, setCreatingWebhook] = useState(false);
  const [createdWebhookSecret, setCreatedWebhookSecret] = useState<string | null>(null);

  const [revokingClient, setRevokingClient] = useState<string | null>(null);
  const [archivingClient, setArchivingClient] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [disablingWebhook, setDisablingWebhook] = useState<string | null>(null);

  // Refetch both queries after mutations. The hooks fetch on mount and serve
  // cached data on revisits, so the tab never blanks while refetching.
  const fetchApiAccess = useCallback(async () => {
    await Promise.all([refreshWebhooks(), refreshUsage()]);
  }, [refreshWebhooks, refreshUsage]);

  async function copyText(value: string, successMsg: string, failMsg: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMsg);
    } catch {
      toast.error(failMsg);
    }
  }

  function toggleSelection(list: string[], value: string, checked: boolean) {
    return checked
      ? Array.from(new Set([...list, value]))
      : list.filter((item) => item !== value);
  }

  async function createClient() {
    if (!clientName.trim() || selectedScopes.length === 0 || !selectedProductId) return;
    setCreatingClient(true);
    try {
      const res = await apiPost<{ apiClient: ApiClientInfo; apiKey: string }>(
        '/api/settings/api-clients',
        {
          name: clientName.trim(),
          scopes: selectedScopes,
          ...(expiresInDays !== 'never' ? { expiresInDays: Number(expiresInDays) } : {}),
          ...(selectedProductId ? { productId: selectedProductId } : {}),
        },
        wsId,
      );
      if (!res.ok) {
        toast.error(apiErrorMessage(res.data, t("toasts.createKeyFailed")));
        return;
      }

      setCreatedKeyMode('created');
      setCreatedApiKey(res.data.apiKey);
      setClientName('');
      setSelectedScopes(['products.read', 'media.write', 'posts.write', 'posts.publish', 'job_runs.read']);
      setExpiresInDays('never');
      setSelectedProductId('');
      setCreateKeyOpen(false);
      await fetchApiAccess();
    } catch {
      toast.error(t("toasts.createKeyFailed"));
    } finally {
      setCreatingClient(false);
    }
  }

  async function revokeClient(id: string) {
    setRevokingClient(id);
    try {
      const res = await apiDelete(`/api/settings/api-clients/${id}`, undefined, wsId);
      if (res.ok) {
        toast.success(t("toasts.keyRevoked"));
        await fetchApiAccess();
      } else {
        toast.error(t("toasts.revokeFailed"));
      }
    } catch {
      toast.error(t("toasts.revokeFailed"));
    } finally {
      setRevokingClient(null);
    }
  }

  async function archiveClient(id: string, archived: boolean) {
    setArchivingClient(id);
    try {
      const res = await apiPost(`/api/settings/api-clients/${id}/archive`, { archived }, wsId);
      if (res.ok) {
        toast.success(archived ? t("toasts.keyArchived") : t("toasts.keyUnarchived"));
        await fetchApiAccess();
      } else {
        toast.error(apiErrorMessage(res.data, archived ? t("toasts.archiveFailed") : t("toasts.unarchiveFailed")));
      }
    } catch {
      toast.error(archived ? t("toasts.archiveFailed") : t("toasts.unarchiveFailed"));
    } finally {
      setArchivingClient(null);
    }
  }

  async function rotateClient() {
    if (!rotateTarget) return;
    setRotatingClient(true);
    try {
      const res = await apiPost<{ apiClient: ApiClientInfo; apiKey: string }>(
        `/api/settings/api-clients/${rotateTarget.id}/rotate`,
        {},
        wsId,
      );
      if (!res.ok) {
        toast.error(apiErrorMessage(res.data, t("toasts.rotateFailed")));
        return;
      }

      setRotateTarget(null);
      setCreatedKeyMode('rotated');
      setCreatedApiKey(res.data.apiKey);
      toast.success(t("toasts.keyRotated"));
      await fetchApiAccess();
    } catch {
      toast.error(t("toasts.rotateFailed"));
    } finally {
      setRotatingClient(false);
    }
  }

  function openEditClient(client: ApiClientInfo) {
    setEditingClient(client);
    setEditingScopes(client.scopes);
    setEditKeyOpen(true);
  }

  async function saveClientScopes() {
    if (!editingClient || editingScopes.length === 0) return;
    setSavingClientScopes(true);
    try {
      const res = await apiPut<{ apiClient: ApiClientInfo }>(
        `/api/settings/api-clients/${editingClient.id}`,
        { scopes: editingScopes },
        wsId,
      );
      if (res.ok) {
        toast.success(t("toasts.permissionsUpdated"));
        setEditKeyOpen(false);
        setEditingClient(null);
        setEditingScopes([]);
        await fetchApiAccess();
      } else {
        toast.error(t("toasts.permissionsUpdateFailed"));
      }
    } catch {
      toast.error(t("toasts.permissionsUpdateFailed"));
    } finally {
      setSavingClientScopes(false);
    }
  }

  async function createWebhook() {
    if (!webhookUrl.trim() || selectedEvents.length === 0) return;
    setCreatingWebhook(true);
    try {
      const res = await apiPost<{ webhookEndpoint: WebhookEndpointInfo & { secret: string } }>(
        '/api/settings/webhook-endpoints',
        { url: webhookUrl.trim(), events: selectedEvents },
        wsId,
      );
      if (!res.ok) {
        toast.error(t("toasts.createWebhookFailed"));
        return;
      }

      setCreatedWebhookSecret(res.data.webhookEndpoint.secret);
      setWebhookUrl('');
      setSelectedEvents(['post.published', 'post.action_required', 'post.failed']);
      setCreateWebhookOpen(false);
      await fetchApiAccess();
    } catch {
      toast.error(t("toasts.createWebhookFailed"));
    } finally {
      setCreatingWebhook(false);
    }
  }

  async function disableWebhook(id: string) {
    setDisablingWebhook(id);
    try {
      const res = await apiDelete(`/api/settings/webhook-endpoints/${id}`, undefined, wsId);
      if (res.ok) {
        toast.success(t("toasts.webhookDisabled"));
        await fetchApiAccess();
      } else {
        toast.error(t("toasts.disableWebhookFailed"));
      }
    } catch {
      toast.error(t("toasts.disableWebhookFailed"));
    } finally {
      setDisablingWebhook(null);
    }
  }

  if (!canManage) {
    return (
      <div className="grid gap-5">
        <Card className="border-border/30">
          <CardHeader>
            <CardTitle>{t("restricted.title")}</CardTitle>
            <CardDescription>{t("restricted.description")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Archived keys (revoked + archived) are hidden from the list by default so
  // the active key roster stays readable; the "Show archived" toggle reveals them.
  const archivedClientCount = apiClientUsage.filter((client) => client.archived).length;
  const visibleClients = showArchived
    ? apiClientUsage
    : apiClientUsage.filter((client) => !client.archived);

  return (
    <div className="grid gap-5">
      <Card className="border-border/30">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                {t("title")}
              </CardTitle>
              <CardDescription>
                {t("description")}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="/developers/api" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <BookOpen className="me-1.5 h-3.5 w-3.5" />
                  {t("viewDocs")}
                </Button>
              </a>
              <Button size="sm" onClick={() => setCreateKeyOpen(true)}>
                {t("createKey")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-xl border p-4">
              <p className="text-sm font-medium">{t("infoCards.videoSupportTitle")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("infoCards.videoSupportDescription")}
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-sm font-medium">{t("infoCards.mediaCapsTitle")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("infoCards.mediaCapsDescription")}
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-sm font-medium">{t("infoCards.inboxTitle")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("infoCards.inboxDescription")}
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{t("stats.requestsThisMonth")}</p>
              {loading ? <Skeleton className="mt-2 h-8 w-16" /> : (
                <p className="mt-2 text-2xl font-semibold tabular-nums">{usageTotals.currentMonthRequests.toLocaleString(locale)}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{formatMonthKey(apiClientUsage[0]?.usage.currentMonth || new Date().toISOString().slice(0, 7), locale)}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{t("stats.queuedPublishes")}</p>
              {loading ? <Skeleton className="mt-2 h-8 w-16" /> : (
                <p className="mt-2 text-2xl font-semibold tabular-nums">{usageTotals.publishQueued.toLocaleString(locale)}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{t("stats.allKeysInWorkspace")}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{t("stats.completedOutcomes")}</p>
              {loading ? <Skeleton className="mt-2 h-8 w-16" /> : (
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {(usageTotals.publishSucceeded + usageTotals.publishActionRequired).toLocaleString(locale)}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {loading
                  ? t("stats.outcomesLoading")
                  : t("stats.outcomesBreakdown", { succeeded: usageTotals.publishSucceeded.toLocaleString(locale), actionRequired: usageTotals.publishActionRequired.toLocaleString(locale) })}
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{t("stats.failures")}</p>
              {loading ? <Skeleton className="mt-2 h-8 w-16" /> : (
                <p className="mt-2 text-2xl font-semibold tabular-nums">{usageTotals.publishFailed.toLocaleString(locale)}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{t("stats.trackedAtCompletion")}</p>
            </div>
          </div>

          {loading ? (
            <div className="py-10 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="rounded-xl border">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{t("keysSection.title")}</p>
                    <p className="text-xs text-muted-foreground">{t("keysSection.description")}</p>
                  </div>
                  {archivedClientCount > 0 && (
                    <Button variant="ghost" size="sm" className="shrink-0 self-start sm:self-auto" onClick={() => setShowArchived((prev) => !prev)}>
                      <Archive className="me-1.5 h-3.5 w-3.5" />
                      {showArchived ? t("keysSection.hideArchived") : t("keysSection.showArchived", { count: archivedClientCount })}
                    </Button>
                  )}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("keysSection.columns.name")}</TableHead>
                      <TableHead>{t("keysSection.columns.usage")}</TableHead>
                      <TableHead>{t("keysSection.columns.publishOutcomes")}</TableHead>
                      <TableHead>{t("keysSection.columns.scopes")}</TableHead>
                      <TableHead>{t("keysSection.columns.status")}</TableHead>
                      <TableHead>{t("keysSection.columns.lastUsed")}</TableHead>
                      <TableHead className="text-end">{t("keysSection.columns.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleClients.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                          {apiClientUsage.length === 0 ? t("keysSection.empty") : t("keysSection.emptyFiltered")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      visibleClients.map((client) => (
                        <TableRow key={client.id}>
                          <TableCell className="min-w-[220px]">
                            <div className="space-y-2">
                              <p className="font-medium">{client.name}</p>
                              <p className="text-xs text-muted-foreground">{client.keyPrefix}…</p>
                              {client.productId && (
                                <Badge variant="outline" className="font-normal text-[10px]">
                                  {t("keysSection.brandBadge", { name: productNameById(client.productId) ?? "" })}
                                </Badge>
                              )}
                              <ApiTrendBars points={client.trend} requestsLabel={t("keysSection.requestsThisMonth")} />
                              <p className="text-[11px] text-muted-foreground">{t("keysSection.trendCaption")}</p>
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[180px]">
                            <div className="space-y-1 text-xs text-muted-foreground">
                              <p><span className="font-medium text-foreground tabular-nums">{(client.usage.currentMonthCounts.request || 0).toLocaleString(locale)}</span> {t("keysSection.requestsThisMonth")}</p>
                              <p><span className="font-medium text-foreground tabular-nums">{client.usage.totalRequests.toLocaleString(locale)}</span> {t("keysSection.totalRequests")}</p>
                              <p>{t("keysSection.uploadsAndPosts", { uploads: (client.usage.currentMonthCounts.media_upload || 0).toLocaleString(locale), posts: (client.usage.currentMonthCounts.post_create || 0).toLocaleString(locale) })}</p>
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[200px]">
                            <div className="space-y-1 text-xs text-muted-foreground">
                              <p><span className="font-medium text-foreground tabular-nums">{(client.usage.currentMonthCounts.publish_queued || 0).toLocaleString(locale)}</span> {t("keysSection.queued")}</p>
                              <p><span className="font-medium text-mk-pos tabular-nums">{(client.usage.currentMonthCounts.publish_succeeded || 0).toLocaleString(locale)}</span> {t("keysSection.directPublish")}</p>
                              <p><span className="font-medium text-primary tabular-nums">{((client.usage.currentMonthCounts.publish_action_required || 0) + (client.usage.currentMonthCounts.publish_exported_for_review || 0)).toLocaleString(locale)}</span> {t("keysSection.actionRequired")}</p>
                              <p><span className="font-medium text-mk-neg tabular-nums">{(client.usage.currentMonthCounts.publish_failed || 0).toLocaleString(locale)}</span> {t("keysSection.failed")}</p>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[320px] whitespace-normal">
                            <div className="flex flex-wrap gap-1.5">
                              {client.scopes.map((scope) => (
                                <Badge key={scope} variant="outline" className="font-normal">{scope}</Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col items-start gap-1.5">
                              <Badge
                                className="border-0"
                                style={pillStyle(client.status === 'active' ? "pos" : "neutral")}
                              >
                                {t(`keysSection.statusLabels.${client.status}`)}
                              </Badge>
                              {client.archived && (
                                <Badge className="border-0" style={pillStyle("neutral")}>{t("keysSection.archivedBadge")}</Badge>
                              )}
                              {client.expiresAt ? (
                                new Date(client.expiresAt).getTime() <= nowAtMount ? (
                                  <Badge className="border-0" style={pillStyle("neg")}>{t("keysSection.expiredBadge")}</Badge>
                                ) : (
                                  <p className="text-[11px] text-muted-foreground">{t("keysSection.expires", { date: formatShortDate(client.expiresAt, locale) })}</p>
                                )
                              ) : (
                                <p className="text-[11px] text-muted-foreground">{t("keysSection.neverExpires")}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleString(locale) : t("keysSection.never")}
                          </TableCell>
                          <TableCell className="text-end">
                            <div className="flex justify-end gap-1.5">
                              {client.archived ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => archiveClient(client.id, false)}
                                  disabled={archivingClient === client.id}
                                >
                                  <ArchiveRestore className="me-1.5 h-3.5 w-3.5" />
                                  {archivingClient === client.id ? t("keysSection.restoring") : t("keysSection.unarchive")}
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openEditClient(client)}
                                    disabled={client.status !== 'active'}
                                  >
                                    <Pencil className="me-1.5 h-3.5 w-3.5" />
                                    {t("keysSection.editPermissions")}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setRotateTarget(client)}
                                    disabled={client.status !== 'active' || rotatingClient}
                                  >
                                    <RefreshCw className="me-1.5 h-3.5 w-3.5" />
                                    {t("keysSection.rotate")}
                                  </Button>
                                  {client.status === 'revoked' ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => archiveClient(client.id, true)}
                                      disabled={archivingClient === client.id}
                                    >
                                      <Archive className="me-1.5 h-3.5 w-3.5" />
                                      {archivingClient === client.id ? t("keysSection.archiving") : t("keysSection.archive")}
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-mk-neg hover:text-mk-neg"
                                      onClick={() => revokeClient(client.id)}
                                      disabled={revokingClient === client.id}
                                    >
                                      <Trash2 className="me-1.5 h-3.5 w-3.5" />
                                      {revokingClient === client.id ? t("keysSection.revoking") : t("keysSection.revoke")}
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          </TableCell>
                      </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-xl border">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{t("webhooksSection.title")}</p>
                    <p className="text-xs text-muted-foreground">{t("webhooksSection.description")}</p>
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0 self-start sm:self-auto" onClick={() => setCreateWebhookOpen(true)}>
                    <Webhook className="me-1.5 h-3.5 w-3.5" />
                    {t("webhooksSection.addWebhook")}
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("webhooksSection.columns.endpoint")}</TableHead>
                      <TableHead>{t("webhooksSection.columns.events")}</TableHead>
                      <TableHead>{t("webhooksSection.columns.status")}</TableHead>
                      <TableHead className="text-end">{t("webhooksSection.columns.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {webhookEndpoints.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                          {t("webhooksSection.empty")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      webhookEndpoints.map((endpoint) => (
                        <TableRow key={endpoint.id}>
                          <TableCell className="max-w-[320px] whitespace-normal">
                            <div className="flex items-start gap-2">
                              <div className="min-w-0">
                                <p className="font-medium break-all">{endpoint.url}</p>
                                <p className="text-xs text-muted-foreground">{t("webhooksSection.created", { date: new Date(endpoint.createdAt).toLocaleString(locale) })}</p>
                              </div>
                              <button
                                className="text-muted-foreground hover:text-foreground transition-colors p-2 -m-1.5 grid place-items-center shrink-0"
                                onClick={() => copyText(endpoint.url, t("toasts.webhookUrlCopied"), t("toasts.webhookUrlCopyFailed"))}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[320px] whitespace-normal">
                            <div className="flex flex-wrap gap-1.5">
                              {endpoint.events.map((eventName) => (
                                <Badge key={eventName} variant="outline" className="font-normal">{eventName}</Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              className="border-0"
                              style={pillStyle(endpoint.status === 'active' ? "pos" : "neutral")}
                            >
                              {t(`webhooksSection.statusLabels.${endpoint.status}`)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-mk-neg hover:text-mk-neg"
                              onClick={() => disableWebhook(endpoint.id)}
                              disabled={endpoint.status !== 'active' || disablingWebhook === endpoint.id}
                            >
                              {disablingWebhook === endpoint.id ? t("webhooksSection.disabling") : t("webhooksSection.disable")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/30">
        <CardHeader>
          <CardTitle>{t("operationalNotes.title")}</CardTitle>
          <CardDescription>{t("operationalNotes.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border p-4">
            <p className="text-sm font-medium">{t("operationalNotes.rateLimitTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("operationalNotes.rateLimitDescription")}
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm font-medium">{t("operationalNotes.webhookSecretTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("operationalNotes.webhookSecretDescription")}
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm font-medium">{t("operationalNotes.asyncTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("operationalNotes.asyncDescription")}
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm font-medium">{t("operationalNotes.tiktokInboxTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("operationalNotes.tiktokInboxDescription")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={createKeyOpen} onOpenChange={setCreateKeyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createKeyDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("createKeyDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-client-name">{t("createKeyDialog.nameLabel")}</Label>
              <Input id="api-client-name" placeholder={t("createKeyDialog.namePlaceholder")} value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-client-expiry">{t("createKeyDialog.expiresLabel")}</Label>
              <Select
                id="api-client-expiry"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value as 'never' | '30' | '90' | '365')}
              >
                <option value="never">{t("createKeyDialog.expiresNever")}</option>
                <option value="30">{t("createKeyDialog.expires30")}</option>
                <option value="90">{t("createKeyDialog.expires90")}</option>
                <option value="365">{t("createKeyDialog.expires365")}</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-client-product">{t("createKeyDialog.brandLabel")}</Label>
              <Select
                id="api-client-product"
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                disabled={products.length === 0}
              >
                <option value="" disabled>{t("createKeyDialog.brandPlaceholder")}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                {products.length === 0
                  ? t("createKeyDialog.brandHelpEmpty")
                  : t("createKeyDialog.brandHelpRequired")}
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{t("createKeyDialog.scopesLabel")}</Label>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    setSelectedScopes(
                      selectedScopes.length === API_SCOPE_OPTIONS.length
                        ? []
                        : API_SCOPE_OPTIONS.map((scope) => scope.id),
                    )
                  }
                >
                  {selectedScopes.length === API_SCOPE_OPTIONS.length ? t("createKeyDialog.clearAll") : t("createKeyDialog.selectAll")}
                </button>
              </div>
              <div className="grid gap-2 rounded-xl border p-3">
                {API_SCOPE_OPTIONS.map((scope) => (
                  <Label key={scope.id} className="justify-start">
                    <Checkbox
                      checked={selectedScopes.includes(scope.id)}
                      onCheckedChange={(checked) => setSelectedScopes((current) => toggleSelection(current, scope.id, checked === true))}
                    />
                    <span>{t(`scopes.${scope.labelKey}`)}</span>
                    <span className="text-xs text-muted-foreground">{scope.id}</span>
                  </Label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateKeyOpen(false)}>{t("createKeyDialog.cancel")}</Button>
            <Button onClick={createClient} disabled={creatingClient || !clientName.trim() || selectedScopes.length === 0 || !selectedProductId}>
              {creatingClient ? t("createKeyDialog.creating") : t("createKeyDialog.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createWebhookOpen} onOpenChange={setCreateWebhookOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createWebhookDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("createWebhookDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">{t("createWebhookDialog.urlLabel")}</Label>
              <Input id="webhook-url" placeholder={t("createWebhookDialog.urlPlaceholder")} value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
            </div>
            <div className="space-y-3">
              <Label>{t("createWebhookDialog.eventsLabel")}</Label>
              <div className="grid gap-2 rounded-xl border p-3">
                {WEBHOOK_EVENT_OPTIONS.map((eventName) => (
                  <Label key={eventName.id} className="justify-start">
                    <Checkbox
                      checked={selectedEvents.includes(eventName.id)}
                      onCheckedChange={(checked) => setSelectedEvents((current) => toggleSelection(current, eventName.id, checked === true))}
                    />
                    <span>{t(`webhookEvents.${eventName.labelKey}`)}</span>
                    <span className="text-xs text-muted-foreground">{eventName.id}</span>
                  </Label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateWebhookOpen(false)}>{t("createWebhookDialog.cancel")}</Button>
            <Button onClick={createWebhook} disabled={creatingWebhook || !webhookUrl.trim() || selectedEvents.length === 0}>
              {creatingWebhook ? t("createWebhookDialog.creating") : t("createWebhookDialog.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editKeyOpen}
        onOpenChange={(open) => {
          setEditKeyOpen(open);
          if (!open) {
            setEditingClient(null);
            setEditingScopes([]);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editKeyDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("editKeyDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border p-3">
              <p className="text-sm font-medium">{editingClient?.name || t("editKeyDialog.fallbackName")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{editingClient?.keyPrefix}…</p>
            </div>
            <div className="space-y-3">
              <Label>{t("editKeyDialog.scopesLabel")}</Label>
              <div className="grid gap-2 rounded-xl border p-3">
                {API_SCOPE_OPTIONS.map((scope) => (
                  <Label key={scope.id} className="justify-start">
                    <Checkbox
                      checked={editingScopes.includes(scope.id)}
                      onCheckedChange={(checked) => setEditingScopes((current) => toggleSelection(current, scope.id, checked === true))}
                    />
                    <span>{t(`scopes.${scope.labelKey}`)}</span>
                    <span className="text-xs text-muted-foreground">{scope.id}</span>
                  </Label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditKeyOpen(false)}>{t("editKeyDialog.cancel")}</Button>
            <Button onClick={saveClientScopes} disabled={savingClientScopes || editingScopes.length === 0}>
              {savingClientScopes ? t("editKeyDialog.saving") : t("editKeyDialog.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rotateTarget} onOpenChange={(open) => { if (!open && !rotatingClient) setRotateTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rotateKeyDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("rotateKeyDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border p-3">
            <p className="text-sm font-medium">{rotateTarget?.name || t("rotateKeyDialog.fallbackName")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{rotateTarget?.keyPrefix}…</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotateTarget(null)} disabled={rotatingClient}>{t("rotateKeyDialog.cancel")}</Button>
            <Button onClick={rotateClient} disabled={rotatingClient}>
              {rotatingClient && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}
              {rotatingClient ? t("rotateKeyDialog.rotating") : t("rotateKeyDialog.rotate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdApiKey} onOpenChange={(open) => { if (!open) setCreatedApiKey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createdKeyMode === 'rotated' ? t("createdKeyDialog.titleRotated") : t("createdKeyDialog.titleCreated")}</DialogTitle>
            <DialogDescription>
              {t("createdKeyDialog.description")}
            </DialogDescription>
          </DialogHeader>
              <div className="rounded-xl border bg-muted/30 p-3">
            <code className="break-all text-xs">{createdApiKey}</code>
          </div>
          <a href="/developers/api" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
            {t("createdKeyDialog.reviewGuide")}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatedApiKey(null)}>{t("createdKeyDialog.close")}</Button>
            <Button onClick={() => createdApiKey && copyText(createdApiKey, t("toasts.apiKeyCopied"), t("toasts.apiKeyCopyFailed"))}>
              <Copy className="me-1.5 h-3.5 w-3.5" />
              {t("createdKeyDialog.copyKey")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdWebhookSecret} onOpenChange={(open) => { if (!open) setCreatedWebhookSecret(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createdWebhookDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("createdWebhookDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border bg-muted/30 p-3">
            <code className="break-all text-xs">{createdWebhookSecret}</code>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("createdWebhookDialog.headerNote")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatedWebhookSecret(null)}>{t("createdWebhookDialog.close")}</Button>
            <Button onClick={() => createdWebhookSecret && copyText(createdWebhookSecret, t("toasts.webhookSecretCopied"), t("toasts.webhookSecretCopyFailed"))}>
              <Copy className="me-1.5 h-3.5 w-3.5" />
              {t("createdWebhookDialog.copySecret")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Billing Tab ──────────────────────────────────────────────────────── */

function BillingTab() {
  const t = useTranslations("settings.billing");
  const locale = useLocale();
  const { status, trialDaysLeft } = useSubscription();
  const { current: workspace } = useWorkspace();
  const [busy, setBusy] = useState(false);

  if (!status) return null;

  const tier = (status.tier ?? 'starter') as PlanTier;
  const plan = PLANS[tier];
  const canManageBilling = workspace?.role === 'owner';

  async function openPortal() {
    setBusy(true);
    try {
      const res = await apiFetch<{ url: string }>("/api/stripe/portal", { method: "POST" });
      if (res.ok && res.data.url) {
        window.open(res.data.url, "_blank", "noopener");
        toast.success(t("toasts.openingPortal"));
      } else {
        toast.error(t("toasts.openPortalFailed"));
      }
    } catch {
      toast.error(t("toasts.somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      {/* Current plan */}
      <Card className="border-border/30">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle>{t("title")}</CardTitle>
              <CardDescription>{t("description")}</CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {status.trialing && (
                <Badge className="bg-primary/10 text-primary border-0">
                  {t("trialBadge", { days: trialDaysLeft ?? 0 })}
                </Badge>
              )}
              {status.active && !status.trialing && (
                <Badge className="border-0" style={pillStyle("pos")}>{t("activeBadge")}</Badge>
              )}
              {status.cancelAtPeriodEnd && (
                <Badge className="border-0" style={pillStyle("warn")}>{t("cancelsAtPeriodEndBadge")}</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {plan ? t("planName", { plan: plan.name }) : t("noActivePlan")}
                  {status.interval && (
                    <span className="text-muted-foreground font-normal">
                      {" "}· {status.interval === "annual" ? t("annualBilling") : t("monthlyBilling")}
                    </span>
                  )}
                </p>
                {plan && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("priceLine", { price: status.interval === "annual" ? plan.price.annual : plan.price.monthly })}
                    {status.currentPeriodEnd && (
                      <> · {t("renews", { date: new Date(status.currentPeriodEnd).toLocaleDateString(locale) })}</>
                    )}
                  </p>
                )}
              </div>
              {canManageBilling ? (
                <Button variant="outline" size="sm" className="shrink-0" onClick={openPortal} disabled={busy}>
                  {busy ? t("opening") : t("manageBilling")}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground sm:text-end">
                  {t("managedByOwner")}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Plan comparison */}
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle>{t("comparePlansTitle")}</CardTitle>
          <CardDescription>{t("comparePlansDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(["starter", "pro", "business"] as const).map((tKey) => {
              const p = PLANS[tKey];
              const isCurrent = tKey === tier;
              return (
                <div
                  key={tKey}
                  className={cn(
                    "rounded-xl border p-4 space-y-3 transition-colors",
                    isCurrent && "border-primary/30 bg-primary/5",
                  )}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{p.name}</p>
                      {isCurrent && <Badge className="bg-primary/10 text-primary border-0 text-[10px]">{t("currentBadge")}</Badge>}
                      {p.badge && !isCurrent && <Badge variant="outline" className="text-[10px]">{p.badge}</Badge>}
                    </div>
                    <p className="text-lg font-bold mt-1">
                      {t("priceMonthly", { price: p.price.monthly })}<span className="text-xs font-normal text-muted-foreground">{t("perMonth")}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{p.description}</p>
                  </div>
                  <div className="space-y-1.5 pt-2 border-t">
                    {p.features.slice(0, 6).map((f) => (
                      <div key={f} className="flex items-start gap-1.5">
                        <Check className="h-3 w-3 text-mk-pos shrink-0 mt-0.5" />
                        <span className="text-xs text-muted-foreground">{f}</span>
                      </div>
                    ))}
                    {p.features.length > 6 && (
                      <p className="text-xs text-muted-foreground ps-4.5">
                        {t("moreFeatures", { count: p.features.length - 6 })}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
