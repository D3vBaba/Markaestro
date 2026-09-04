"use client";

import Link from "next/link";

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useState, useCallback, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/app/PageHeader";
import Section from "@/components/app/Section";
import Notice from "@/components/app/Notice";
import EmptyState from "@/components/app/EmptyState";
import FormField from "@/components/app/FormField";
import { StatGrid, StatTile } from "@/components/app/StatTile";
import Select from "@/components/app/Select";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import ConnectChannelDialog, { type ConnectDialogRequest } from "@/components/app/ConnectChannelDialog";
import ConnectionOutcomeCard, { readConnectOutcome, type ConnectOutcome } from "@/components/app/ConnectionOutcomeCard";
import MediaLibrary from "@/components/app/MediaLibrary";
import AppLocaleSwitcher from "@/components/app/AppLocaleSwitcher";
import { apiDelete, apiGet, apiPost, apiPut, apiFetch, getApiWorkspaceId, DESTRUCTIVE_REQUEST_TIMEOUT_MS } from "@/lib/api-client";
import { deferFromEffect } from "@/lib/defer-from-effect";
import { startOAuthAuthorize } from "@/lib/in-app-browser";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useAuth, friendlyAuthError } from "@/components/providers/AuthProvider";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { PLANS, PLAN_TIERS } from "@/lib/stripe/plans";
import type { BillingInterval, PlanTier } from "@/lib/stripe/plans";
import { cn } from "@/lib/utils";
import { Status } from "@/components/mk/Status";
import { Channel } from "@/components/mk/Channel";
import { resolveChannelStatus, type ChannelStatus } from "@/lib/integrations/channel-status";
import { userFacingError } from "@/lib/user-facing-errors";
import {
  Link2, Pencil, Check, X, Loader2, KeyRound, Mail,
  Copy, Webhook, BookOpen, ExternalLink, Trash2, RefreshCw,
  Archive, ArchiveRestore, Plus, Minus, Users,
} from "lucide-react";

type Member = {
  uid: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'analyst';
  joinedAt?: string;
};

type PendingInviteInfo = {
  id: string;
  email: string;
  role: 'admin' | 'member' | 'analyst';
  invitedByEmail?: string;
  invitedAt?: string;
};

type WorkspaceRow = { id: string; name: string; role: 'owner' | 'admin' | 'member' | 'analyst' };

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
  origin?: 'manual' | 'oauth';
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
  return userFacingError(data, fallback);
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
            className="w-full rounded-t-sm bg-mk-accent/70"
            style={{ height: `${Math.max((point.requests / max) * 100, point.requests > 0 ? 10 : 2)}%` }}
            title={`${point.label}: ${point.requests} ${requestsLabel}`}
          />
        </div>
      ))}
    </div>
  );
}

type WebhookEndpointHealth = {
  endpointId: string;
  delivered24h: number;
  failed24h: number;
  pending: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
};

type WebhookEndpointInfo = {
  id: string;
  url: string;
  events: string[];
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt?: string;
  /** Rolling 24-hour delivery counts, so a broken endpoint shows in the list. */
  health?: WebhookEndpointHealth | null;
};

type WebhookDeliveryInfo = {
  id: string;
  eventType: string;
  status: string;
  attemptCount: number;
  responseCode: number | null;
  lastError: string;
  createdAt: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
};

const API_SCOPE_OPTIONS = [
  { id: 'products.read', labelKey: 'productsRead' },
  { id: 'media.write', labelKey: 'mediaWrite' },
  { id: 'posts.read', labelKey: 'postsRead' },
  { id: 'posts.write', labelKey: 'postsWrite' },
  { id: 'posts.publish', labelKey: 'postsPublish' },
  { id: 'evergreen.read', labelKey: 'evergreenRead' },
  { id: 'evergreen.write', labelKey: 'evergreenWrite' },
  { id: 'job_runs.read', labelKey: 'jobRunsRead' },
  { id: 'webhooks.manage', labelKey: 'webhooksManage' },
] as const;

const WEBHOOK_EVENT_OPTIONS = [
  { id: 'post.publish.queued', labelKey: 'postPublishQueued' },
  { id: 'post.published', labelKey: 'postPublished' },
  { id: 'post.action_required', labelKey: 'postActionRequired' },
  { id: 'post.failed', labelKey: 'postFailed' },
  { id: 'evergreen.queue.activated', labelKey: 'evergreenQueueActivated' },
  { id: 'evergreen.queue.paused', labelKey: 'evergreenQueuePaused' },
  { id: 'evergreen.queue.needs_review', labelKey: 'evergreenQueueNeedsReview' },
  { id: 'evergreen.run.scheduled', labelKey: 'evergreenRunScheduled' },
  { id: 'evergreen.run.skipped', labelKey: 'evergreenRunSkipped' },
  { id: 'evergreen.run.underperformed', labelKey: 'evergreenRunUnderperformed' },
] as const;

const TABS = [
  { id: 'account' },
  { id: 'usage' },
  { id: 'integrations' },
  { id: 'team' },
  { id: 'workspaces' },
  { id: 'api' },
  { id: 'billing' },
] as const;
type Tab = typeof TABS[number]['id'];

/* ─── Shared row primitives ────────────────────────────────────────────────── */

/**
 * One row of a settings group: label and helper text on the left, the
 * control on the right. Stacks on small screens. Rows share `divide-y`
 * inside a bordered Section instead of each becoming a card.
 */
function SettingsRow({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description ? (
          <div className="mt-0.5 text-[13px] leading-5 text-muted-foreground text-pretty">{description}</div>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** Structural skeleton that matches the SettingsRow layout. */
function RowSkeletons({ rows = 3, control = true }: { rows?: number; control?: boolean }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          {control ? <Skeleton className="h-8 w-20" /> : null}
        </div>
      ))}
    </div>
  );
}

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
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")}>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as Tab)}>
          <TabsList variant="line" className="w-full overflow-x-auto scrollbar-hide">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} data-tab={tab.id}>
                {t(`tabs.${tab.id}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeader>

      {activeTab === 'account' && <AccountTab />}
      {activeTab === 'usage' && <UsageTab onUpgrade={() => setActiveTab('billing')} />}
      {activeTab === 'integrations' && <IntegrationsTab />}
      {activeTab === 'team' && <TeamTab />}
      {activeTab === 'workspaces' && <WorkspacesTab />}
      {activeTab === 'api' && <ApiAccessTab />}
      {activeTab === 'billing' && <BillingTab />}
    </>
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
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);

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

  async function confirmDeleteAccount() {
    const res = await apiFetch('/api/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirmation: email }),
      timeoutMs: DESTRUCTIVE_REQUEST_TIMEOUT_MS,
    });
    if (!res.ok) {
      toast.error(t("dangerZone.deleteFailed"));
      return;
    }
    toast.success(t("dangerZone.deleted"));
    await logout();
  }

  return (
    <div className="space-y-8">
      {/* Profile */}
      <Section title={t("profile.title")} description={t("profile.description")} bordered>
        <div className="flex items-start gap-4 px-4 py-4 sm:px-5">
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt={displayName}
              className="size-12 shrink-0 rounded-full border border-border object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="grid size-12 shrink-0 place-items-center rounded-full bg-muted">
              <span className="text-sm font-semibold text-mk-ink-80">{initials}</span>
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-3">
            <div className="min-w-0">
              <p className="m-0 truncate text-sm font-medium text-foreground">{displayName}</p>
              <p className="m-0 truncate text-[13px] text-muted-foreground">{email}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {providers.map((p) => (
                <Badge key={p} variant="outline">
                  {isEmailCodeLabel(p) ? <KeyRound /> : null}
                  {isGoogleLabel(p) ? <Mail /> : null}
                  {p}
                </Badge>
              ))}
              {workspace && (
                <Badge variant="accent" className="capitalize">
                  {workspace.role}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* Language */}
      <Section bordered>
        <div className="px-4 py-4 sm:px-5">
          <AppLocaleSwitcher />
        </div>
      </Section>

      {/* Security */}
      <Section title={t("security.title")} description={t("security.description")} bordered>
        <div className="divide-y divide-border">
          <SettingsRow
            title={t("security.passwordlessTitle")}
            description={t("security.passwordlessDescription")}
          />

          {canChangeEmail && (
            <div className="px-4 py-4 sm:px-5">
              {pendingEmailChange ? (
                <FormField
                  label={t("security.changeEmailTitle")}
                  htmlFor="account-email-code"
                  description={t("security.changeEmailDescription")}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="warning" className="whitespace-normal break-all">
                        {t("security.codeSentTo", { email: pendingEmailChange })}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={handleResendEmailChange}
                        disabled={resendingEmailChange}
                      >
                        {resendingEmailChange ? t("security.resending") : t("security.resend")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => { setPendingEmailChange(null); setEmailChangeCode(''); }}
                      >
                        {t("security.cancel")}
                      </Button>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="account-email-code"
                        value={emailChangeCode}
                        onChange={(e) => setEmailChangeCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="123456"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        className="text-center font-mono sm:max-w-[160px]"
                        onKeyDown={(e) => e.key === 'Enter' && handleConfirmEmailChange()}
                      />
                      <Button
                        variant="outline"
                        onClick={handleConfirmEmailChange}
                        disabled={confirmingEmailChange || emailChangeCode.length < 6}
                      >
                        {confirmingEmailChange ? t("security.confirming") : t("security.confirmChange")}
                      </Button>
                    </div>
                  </div>
                </FormField>
              ) : (
                <FormField
                  label={t("security.changeEmailTitle")}
                  htmlFor="account-new-email"
                  description={t("security.changeEmailDescription")}
                >
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="account-new-email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder={t("security.newEmailPlaceholder")}
                      type="email"
                      className="sm:max-w-[360px]"
                    />
                    <Button
                      variant="outline"
                      onClick={handleEmailChange}
                      disabled={changingEmail || !newEmail.trim()}
                    >
                      {changingEmail ? t("security.sending") : t("security.sendCode")}
                    </Button>
                  </div>
                </FormField>
              )}
            </div>
          )}

          <SettingsRow
            title={t("security.signOutTitle")}
            description={t("security.signOutDescription")}
          >
            <Button variant="outline" size="sm" onClick={logout}>
              {t("security.signOut")}
            </Button>
          </SettingsRow>
        </div>
      </Section>

      {/* Danger zone */}
      <Section title={t("dangerZone.title")} description={t("dangerZone.description")} bordered>
        <SettingsRow
          title={t("dangerZone.deleteTitle")}
          description={t("dangerZone.deleteDescription")}
        >
          <Button variant="outline" size="sm" className="text-mk-neg" onClick={() => setDeleteAccountOpen(true)}>
            {t("dangerZone.deleteAccount")}
          </Button>
        </SettingsRow>
      </Section>

      <ConfirmDeleteDialog
        open={deleteAccountOpen}
        onOpenChange={setDeleteAccountOpen}
        entity="account"
        name={email}
        requireTypedConfirmation
        warning={t("dangerZone.deleteWarning")}
        confirmLabel={t("dangerZone.deleteAccount")}
        onConfirm={confirmDeleteAccount}
      />
    </div>
  );
}

/* ─── Usage Tab ────────────────────────────────────────────────────────────── */

/** Label row plus a 6px bar; the hue carries how close to the limit you are. */
function MeterBar({ pct, tone }: { pct: number; tone: "accent" | "warn" | "neg" | "pos" }) {
  const fill = {
    accent: "bg-mk-accent",
    warn: "bg-mk-warn",
    neg: "bg-mk-neg",
    pos: "bg-mk-pos",
  }[tone];
  return (
    <div className="h-1.5 overflow-hidden rounded-sm bg-muted">
      <div
        className={cn("h-full w-full origin-left rounded-sm transition-transform duration-300 ease-out-quart rtl:origin-right", fill)}
        style={{ transform: `scaleX(${pct / 100})` }}
      />
    </div>
  );
}

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
    <div className="space-y-2 px-4 py-4 sm:px-5">
      <div className="flex items-center justify-between gap-4">
        <p className="m-0 text-sm font-medium text-foreground">{label}</p>
        <p
          className={cn(
            "m-0 text-[13px] tabular-nums",
            isFull ? "font-medium text-mk-neg" : isHigh ? "text-mk-warn" : "text-muted-foreground",
          )}
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
        <MeterBar pct={pct} tone={isFull ? "neg" : isHigh ? "warn" : "accent"} />
      )}
      {unlimited && <MeterBar pct={15} tone="pos" />}
    </div>
  );
}

/** Bytes → GB display value, one decimal max ("2.4", "10"). */
function formatGb(bytes: number, locale: string) {
  return (bytes / 1024 ** 3).toLocaleString(locale, { maximumFractionDigits: 1 });
}

/**
 * Storage usage in GB with the same bar treatment as UsageMeter.
 * `limit` null (or -1) means unlimited.
 */
function StorageMeter({
  current,
  limit,
  locale,
}: {
  current: number;
  limit: number | null;
  locale: string;
}) {
  const t = useTranslations("settings.usage");
  const unlimited = limit === null || limit === -1;
  const pct = unlimited || limit <= 0 ? 0 : Math.min((current / limit) * 100, 100);
  const isHigh = pct >= 80;
  const isFull = pct >= 100;

  return (
    <div className="space-y-2 px-4 py-4 sm:px-5">
      <div className="flex items-center justify-between gap-4">
        <p className="m-0 text-sm font-medium text-foreground">{t("storage")}</p>
        <p
          className={cn(
            "m-0 text-[13px] tabular-nums",
            isFull ? "font-medium text-mk-neg" : isHigh ? "text-mk-warn" : "text-muted-foreground",
          )}
        >
          {unlimited
            ? t("storageUsed", { current: formatGb(current, locale) })
            : t("storageUsedOf", {
                current: formatGb(current, locale),
                limit: formatGb(limit, locale),
              })}
        </p>
      </div>
      {unlimited ? (
        <MeterBar pct={15} tone="pos" />
      ) : (
        <MeterBar pct={pct} tone={isFull ? "neg" : isHigh ? "warn" : "accent"} />
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
      /** Absent on older servers (deploy skew) — hide the card then. */
      storage?: { current: number; limit: number | null };
      posts: UsageMetric;
      brands: UsageMetric;
      teamMembers: UsageMetric;
      workspaces: UsageMetric;
    };
    tier: PlanTier;
    plan: string;
  }>("/api/usage");
  const usage = usageData?.usage ?? null;

  // The server's tier is the effective one (workspace sub + account
  // entitlement, lapsed subs resolved to free); prefer it over client state.
  const tier = (usageData?.tier ?? status?.tier ?? 'free') as PlanTier;
  const plan = PLANS[tier];

  if (loading) {
    return (
      <div className="space-y-8">
        <Section title={t("title")} bordered>
          <div className="divide-y divide-border">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-3 px-4 py-4 sm:px-5">
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-1.5 w-full rounded-sm" />
              </div>
            ))}
          </div>
        </Section>
        <Section title={t("planLimitsTitle")} bordered>
          <RowSkeletons rows={2} control={false} />
        </Section>
      </div>
    );
  }

  const month = new Date().toLocaleDateString(locale, { month: "long", year: "numeric" });

  return (
    <div className="space-y-8">
      <Section
        title={t("title")}
        description={`${month}, ${plan.name}`}
        action={status?.trialing ? <Badge variant="accent">{t("trial")}</Badge> : undefined}
        bordered
      >
        <div className="divide-y divide-border">
          {/* Brands (products vs plan limit, add-on packs included) */}
          <UsageMeter
            label={t("brandsRegistered")}
            current={usage?.brands.current ?? 0}
            limit={usage?.brands.limit ?? plan.limits.brands}
            locale={locale}
          />

          {/* Storage (bytes from the server; hidden entirely on deploy skew) */}
          {usage?.storage && (
            <StorageMeter
              current={usage.storage.current}
              limit={usage.storage.limit}
              locale={locale}
            />
          )}

          {/* Posts — metered on the free tier only; paid tiers are unlimited */}
          {(usage?.posts.limit ?? plan.limits.postsPerMonth) !== -1 && (
            <UsageMeter
              label={t("posts")}
              current={usage?.posts.current ?? 0}
              limit={usage?.posts.limit ?? plan.limits.postsPerMonth}
              locale={locale}
            />
          )}
        </div>
      </Section>

      {/* The media library sits directly under the storage meter: the
          meter says how full you are, this is how you do something
          about it. */}
      {usage?.storage && (
        <Section bordered contentClassName="p-4 sm:p-5">
          <MediaLibrary />
        </Section>
      )}

      {/* Plan limits summary */}
      <Section title={t("planLimitsTitle")} description={t("planLimitsDescription", { plan: plan.name })} bordered>
        <div className="divide-y divide-border">
          <div className="grid grid-cols-1 gap-x-8 gap-y-2.5 px-4 py-4 sm:grid-cols-2 sm:px-5">
            {plan.features.map((f) => (
              <div key={f} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 size-3.5 shrink-0 text-mk-pos" />
                <span className="text-mk-ink-80">{f}</span>
              </div>
            ))}
          </div>
          <div className="px-4 py-3 sm:px-5">
            <Button variant="outline" size="sm" onClick={onUpgrade}>
              {t("upgradePlan")}
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}

/* ─── Integrations Tab ──────────────────────────────────────────────────── */

// Each product links its own individual account per channel — nothing is shared
// across products, and Facebook and Instagram are separate links.
const PRODUCT_CHANNELS: { provider: string; channelKey: string; iconKey: string }[] = [
  { provider: "meta", channelKey: "meta", iconKey: "facebook" },
  { provider: "instagram", channelKey: "instagram", iconKey: "instagram" },
  { provider: "tiktok", channelKey: "tiktok", iconKey: "tiktok" },
  { provider: "threads", channelKey: "threads", iconKey: "threads" },
  { provider: "pinterest", channelKey: "pinterest", iconKey: "pinterest" },
  { provider: "linkedin", channelKey: "linkedin", iconKey: "linkedin" },
  { provider: "x", channelKey: "x", iconKey: "x" },
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
  /** Scopes the platform reported on the grant, when it reported any. */
  grantedScopes?: string[] | null;
};

type MetaPage = { id: string; name: string; hasInstagram: boolean; igAccountId: string | null; accountId?: string | null; accountLabel?: string | null };

const MANUAL_POSTING_CHANNELS = [
  { id: "instagram" },
  { id: "facebook" },
  { id: "tiktok" },
  { id: "threads" },
  { id: "linkedin" },
  { id: "pinterest" },
  { id: "x" },
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
    <Section title={t("title")} description={t("description")} bordered>
      <div className="divide-y divide-border">
        {MANUAL_POSTING_CHANNELS.map((channel) => (
          <div key={channel.id} className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <Channel channel={channel.id} size={24} />
              <div className="min-w-0">
                <p className="m-0 text-sm font-medium text-foreground">{tChannels(channel.id)}</p>
                <p className="m-0 mt-0.5 text-[13px] leading-5 text-muted-foreground">
                  {enabled.has(channel.id)
                    ? t("manualStatus")
                    : t("automatedStatus")}
                </p>
              </div>
            </div>
            <Switch
              checked={enabled.has(channel.id)}
              disabled={!canManage || loading || savingChannel === channel.id}
              onCheckedChange={() => toggleChannel(channel.id)}
              aria-label={tChannels(channel.id)}
            />
          </div>
        ))}
      </div>
    </Section>
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

  // Connect / Reconnect open the explainer dialog first; Continue navigates.
  const [connectRequest, setConnectRequest] = useState<(ConnectDialogRequest & { productId: string }) | null>(null);
  // What the OAuth callback reported, shown as a persistent panel rather than
  // a toast, on the brand it belongs to.
  const [connectOutcome, setConnectOutcome] = useState<{ outcome: ConnectOutcome; productId: string | null } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = readConnectOutcome(params);
    if (!outcome) return;
    const productId = params.get("productId");
    deferFromEffect(() => setConnectOutcome({ outcome, productId }));
    window.history.replaceState({}, "", "/settings?tab=integrations");
    if (outcome.result === "success") {
      const timer = setTimeout(() => invalidateQueries("/api/integrations"), 500);
      return () => clearTimeout(timer);
    }
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
        setPagesError(t("pagePicker.noneFound"));
        return;
      }
      setPages(res.data.pages || []);
      setLinkedPageIds(res.data.linkedIds || []);
      if (res.data.error) setPagesError(t("pagePicker.noneFound"));
    })();
    return () => { cancelled = true; };
  }, [pagePickerProduct, wsId, t]);

  function connect(
    provider: string,
    productId: string,
    linkedinMode?: "profile" | "community",
    mode: "connect" | "reconnect" = "connect",
  ) {
    setConnectRequest({ provider, productId, linkedinMode, mode });
  }

  function launchConnect(provider: string, productId: string, linkedinMode?: "profile" | "community") {
    const qs = new URLSearchParams({
      workspaceId: getApiWorkspaceId(),
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
      <div className="space-y-8">
        {[0, 1].map((i) => (
          <Section key={i} bordered>
            <RowSkeletons rows={3} />
          </Section>
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="space-y-8">
        <ManualPostingCard />
        <EmptyState
          icon={Link2}
          title={t("noProductsTitle")}
          description={t("noProductsDescription")}
          action={
            <Button asChild>
              <Link href="/products">{t("createBrand")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <ManualPostingCard />

      <p className="m-0 text-[13px] leading-5 text-muted-foreground text-pretty">
        {t("linkDescription")}
      </p>

      {products.map((product) => (
        <Section key={product.id} title={product.name} bordered>
          <div className="divide-y divide-border">
            {connectOutcome && (connectOutcome.productId ?? product.id) === product.id && (() => {
              const entry = (connsByProduct[product.id] || []).find((c) => c.provider === connectOutcome.outcome.provider);
              const account = entry?.username
                ? `@${entry.username}`
                : entry?.pageName || entry?.boardName || entry?.linkedinDestinationName || null;
              return (
                <div className="p-4 sm:p-5">
                  <ConnectionOutcomeCard
                    outcome={connectOutcome.outcome}
                    brandName={product.name}
                    account={account}
                    grantedScopes={entry?.grantedScopes}
                    onDismiss={() => setConnectOutcome(null)}
                    onTryAgain={() => connect(connectOutcome.outcome.provider, product.id, connectOutcome.outcome.linkedinMode ?? undefined)}
                    onChoosePages={() => setPagePickerProduct(product.id)}
                  />
                </div>
              );
            })()}
            {PRODUCT_CHANNELS.map((ch) => {
              const st = channelStatus(product.id, ch.provider);
              const isBusy = busy === `${product.id}:${ch.provider}`;
              const accounts = channelAccounts(product.id, ch.provider);
              const channelLabel = t(`channels.${ch.channelKey}.label`);
              return (
                <div key={ch.provider} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <Channel channel={ch.iconKey} size={24} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="m-0 text-sm font-medium text-foreground">{channelLabel}</p>
                          {st.state === "connected" && <Badge variant="positive">{t("linked")}</Badge>}
                          {st.state === "needs-page" && (
                            <Badge variant="warning">
                              {ch.provider === "pinterest" ? t("pickBoard") : ch.provider === "linkedin" ? t("pickTarget") : t("pickPage")}
                            </Badge>
                          )}
                        </div>
                        <p className="m-0 mt-0.5 truncate text-[13px] leading-5 text-muted-foreground">
                          {st.state === "connected" ? (st.label || t("linkedAndReady")) : t(`channels.${ch.channelKey}.sub`)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {st.state === "connected" ? (
                        <>
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
                            onClick={() => connect(ch.provider, product.id, undefined, "reconnect")}
                          >
                            {ch.provider === "meta" ? t("reconnectAddAccount") : t("reconnect")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-mk-neg"
                            disabled={isBusy}
                            onClick={() => setDisconnectTarget({ productId: product.id, provider: ch.provider, label: `${channelLabel} · ${product.name}` })}
                          >
                            {isBusy ? t("unlinking") : accounts.length > 1 ? t("unlinkAll") : t("unlink")}
                          </Button>
                        </>
                      ) : st.state === "needs-page" ? (
                        ch.provider === "pinterest" ? (
                          <Button size="sm" asChild><Link href="/products">{t("chooseBoard")}</Link></Button>
                        ) : ch.provider === "linkedin" ? (
                          <Button size="sm" asChild><Link href="/products">{t("chooseTarget")}</Link></Button>
                        ) : (
                          <Button size="sm" onClick={() => setPagePickerProduct(product.id)}>{t("choosePage")}</Button>
                        )
                      ) : ch.provider === "linkedin" ? (
                        <>
                          <Button size="sm" onClick={() => connect(ch.provider, product.id, "profile")}>{t("profileButton")}</Button>
                          <Button size="sm" variant="outline" onClick={() => connect(ch.provider, product.id, "community")}>{t("pagesButton")}</Button>
                        </>
                      ) : (
                        <Button size="sm" onClick={() => connect(ch.provider, product.id)}>{t("link")}</Button>
                      )}
                    </div>
                  </div>
                  {accounts.length > 0 && (
                    <div className="mt-3 flex flex-col gap-1">
                      {accounts.map((account) => {
                        const label = account.label || account.destinationId || t("linkedAccountFallback");
                        const accountBusy = busy === `${product.id}:${ch.provider}:${account.destinationId}`;
                        return (
                          <div
                            key={account.connectionId}
                            className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5"
                          >
                            <span className="min-w-0 flex-1 truncate text-[13px] text-mk-ink-80">{label}</span>
                            {account.enabled === false && (
                              <Badge variant="warning">
                                {account.status === "revoked" ? t("reconnect") : account.status}
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="xs"
                              disabled={accountBusy}
                              onClick={() => unlinkAccount(product.id, ch.provider, account.destinationId!, label)}
                            >
                              {accountBusy ? t("unlinking") : t("unlink")}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
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
          <div className="max-h-[50vh] overflow-y-auto">
            {pages === null ? (
              <RowSkeletons rows={2} />
            ) : pagesError && pages.length === 0 ? (
              <Notice tone="warning">{pagesError}</Notice>
            ) : pages.length === 0 ? (
              <p className="m-0 text-[13px] text-muted-foreground">{t("pagePicker.noneFound")}</p>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {pages.map((pg) => (
                  <button
                    key={pg.id}
                    type="button"
                    disabled={!!selectingPage || linkedPageIds.includes(pg.id)}
                    onClick={() => selectPage(pg)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
                  >
                    <div className="min-w-0">
                      <p className="m-0 truncate text-sm font-medium text-foreground">{pg.name}</p>
                      <p className="m-0 truncate text-[13px] text-muted-foreground">
                        {pg.accountLabel ? `via ${pg.accountLabel}` : t("channels.meta.label")}
                      </p>
                    </div>
                    <span className="shrink-0 text-[13px] font-medium text-mk-accent">
                      {linkedPageIds.includes(pg.id)
                        ? t("linked")
                        : selectingPage === pg.id
                        ? t("pagePicker.linking")
                        : t("link")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConnectChannelDialog
        request={connectRequest}
        brandName={connectRequest ? products.find((p) => p.id === connectRequest.productId)?.name ?? null : null}
        onOpenChange={(open) => { if (!open) setConnectRequest(null); }}
        onContinue={(request) => {
          if (!connectRequest) return;
          launchConnect(request.provider, connectRequest.productId, request.linkedinMode);
        }}
      />

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
  const { user } = useAuth();
  const { current: workspace, refresh: refreshWorkspaces } = useWorkspace();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteEmailError, setInviteEmailError] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'analyst'>('member');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ uid: string; email: string } | null>(null);
  const [roleSaving, setRoleSaving] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<{ uid: string; email: string } | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [inviteBusyEmail, setInviteBusyEmail] = useState<string | null>(null);

  const wsId = workspace?.id ?? 'default';
  const tier = (status?.tier ?? 'starter') as PlanTier;
  const plan = PLANS[tier];
  const limit = plan.limits.teamMembers;
  const canInvite = workspace?.role === 'owner' || workspace?.role === 'admin';
  const isOwner = workspace?.role === 'owner';

  const {
    data: membersData,
    loading: membersLoading,
    refresh: fetchMembers,
  } = useApiQuery<{ members: Member[]; pendingInvites: PendingInviteInfo[] }>('/api/team', { wsId });
  const members = membersData?.members ?? [];
  const pendingInvites = membersData?.pendingInvites ?? [];
  // Pending invites hold a seat: the server counts them toward the plan
  // limit, so the form must too or invites fail with a surprise error.
  const seatsUsed = members.length + pendingInvites.length;

  async function invite(emailOverride?: string, roleOverride?: 'admin' | 'member' | 'analyst') {
    const candidate = (emailOverride ?? inviteEmail).trim();
    const role = roleOverride ?? inviteRole;
    if (!candidate) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
      setInviteEmailError(t("toasts.invalidEmail"));
      return;
    }
    setInviteEmailError(null);
    if (emailOverride) setInviteBusyEmail(candidate);
    else setInviting(true);
    try {
      const res = await apiPost<{ status: string; email: string }>('/api/team', { email: candidate, role }, wsId);
      if (res.ok) {
        // The server never adds the user directly — it records an invite the
        // person accepts on their own account.
        toast.success(t("toasts.inviteSent", { email: res.data.email }));
        if (!emailOverride) setInviteEmail('');
        fetchMembers();
      } else {
        const err = (res.data as { error?: string }).error;
        if (err === 'TEAM_LIMIT_REACHED') toast.error(t("toasts.limitReached", { plan: plan.name, limit }));
        else if (err === 'FORBIDDEN') toast.error(t("toasts.adminInviteOwnerOnly"));
        else toast.error(t("toasts.inviteFailed"));
      }
    } catch {
      toast.error(t("toasts.somethingWrong"));
    } finally {
      setInviting(false);
      setInviteBusyEmail(null);
    }
  }

  async function revokeInvite(email: string) {
    setInviteBusyEmail(email);
    try {
      const res = await apiFetch(`/api/team/invites?email=${encodeURIComponent(email)}&workspaceId=${wsId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(t("toasts.inviteRevoked", { email }));
        fetchMembers();
      } else {
        toast.error(t("toasts.revokeFailed"));
      }
    } catch {
      toast.error(t("toasts.somethingWrong"));
    } finally {
      setInviteBusyEmail(null);
    }
  }

  async function changeRole(uid: string, role: 'admin' | 'member' | 'analyst') {
    setRoleSaving(uid);
    try {
      const res = await apiFetch(`/api/team/${uid}?workspaceId=${wsId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        toast.success(t("toasts.roleChanged", { role: t(`roleLabels.${role}`) }));
        fetchMembers();
      } else {
        toast.error(t("toasts.roleChangeFailed"));
      }
    } catch {
      toast.error(t("toasts.somethingWrong"));
    } finally {
      setRoleSaving(null);
    }
  }

  async function confirmTransferOwnership() {
    if (!transferTarget) return;
    setTransferring(true);
    try {
      const res = await apiFetch(`/api/team/${transferTarget.uid}/transfer-ownership?workspaceId=${wsId}`, { method: 'POST' });
      if (res.ok) {
        toast.success(t("toasts.ownershipTransferred", { email: transferTarget.email }));
        setTransferTarget(null);
        fetchMembers();
        await refreshWorkspaces();
      } else {
        toast.error(t("toasts.transferFailed"));
      }
    } catch {
      toast.error(t("toasts.somethingWrong"));
    } finally {
      setTransferring(false);
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

  const canInviteMore = canInvite && (limit === -1 || seatsUsed < limit);
  const limitHit = canInvite && limit !== -1 && seatsUsed >= limit;

  return (
    <div className="space-y-8">
      <Section
        title={t("membersTitle")}
        description={
          limit === -1
            ? t("unlimitedMembers", { plan: plan.name })
            : t("memberCount", { count: membersLoading ? "…" : seatsUsed, limit, plan: plan.name })
        }
        bordered
      >
        <div className="divide-y divide-border">
          {membersLoading && <RowSkeletons rows={2} />}
          {!membersLoading && members.length === 0 && (
            <EmptyState compact icon={Users} title={t("noMembers")} className="rounded-none border-0" />
          )}
          {members.map((m) => {
            const isSelf = m.uid === user?.uid;
            const canManageThisRole = isOwner && !isSelf && m.role !== 'owner';
            return (
              <div key={m.uid} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-8 shrink-0 place-items-center rounded-full bg-muted">
                    <span className="text-xs font-semibold text-mk-ink-80">
                      {m.email.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="m-0 truncate text-sm font-medium text-foreground">{m.email}</p>
                      {isSelf && <Badge variant="accent">{t("youBadge")}</Badge>}
                    </div>
                    <p className="m-0 mt-0.5 text-[13px] leading-5 text-muted-foreground">
                      {t(`roleLabels.${m.role}`)}
                      {roleDescriptions[m.role] ? `: ${roleDescriptions[m.role]}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {canManageThisRole && (
                    <div className="w-32">
                      <Select
                        size="sm"
                        value={m.role}
                        disabled={roleSaving === m.uid}
                        onChange={(e) => changeRole(m.uid, e.target.value as 'admin' | 'member' | 'analyst')}
                        aria-label={t("roles.title")}
                      >
                        <option value="member">{t("roleLabels.member")}</option>
                        <option value="analyst">{t("roleLabels.analyst")}</option>
                        <option value="admin">{t("roleLabels.admin")}</option>
                      </Select>
                    </div>
                  )}
                  {canManageThisRole && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTransferTarget({ uid: m.uid, email: m.email })}
                    >
                      {t("makeOwner")}
                    </Button>
                  )}
                  {canInvite && m.role !== 'owner' && !isSelf && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-mk-neg"
                      onClick={() => setRemoveTarget({ uid: m.uid, email: m.email })}
                      disabled={removing === m.uid}
                    >
                      {removing === m.uid ? t("removing") : t("remove")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Invite form */}
          {canInviteMore && (
            <div className="px-4 py-4 sm:px-5">
              <FormField label={t("inviteLabel")} htmlFor="team-invite-email" error={inviteEmailError}>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="team-invite-email"
                    type="email"
                    placeholder={t("emailPlaceholder")}
                    value={inviteEmail}
                    onChange={(e) => { setInviteEmail(e.target.value); if (inviteEmailError) setInviteEmailError(null); }}
                    onKeyDown={(e) => e.key === 'Enter' && invite()}
                    aria-invalid={inviteEmailError ? true : undefined}
                    className="flex-1"
                  />
                  <div className="sm:w-36">
                    <Select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member' | 'analyst')}
                      aria-label={t("roles.title")}
                    >
                      <option value="member">{t("roleLabels.member")}</option>
                      <option value="analyst">{t("roleLabels.analyst")}</option>
                      {isOwner && <option value="admin">{t("roleLabels.admin")}</option>}
                    </Select>
                  </div>
                  <Button onClick={() => invite()} disabled={inviting || !inviteEmail.trim()}>
                    {inviting ? t("inviting") : t("invite")}
                  </Button>
                </div>
              </FormField>
            </div>
          )}

          {limitHit && (
            <p className="m-0 px-4 py-3 text-[13px] leading-5 text-muted-foreground sm:px-5">
              {t("limitReached")}{' '}
              <Link href="/settings?tab=billing" className="text-mk-accent hover:underline">{t("upgradePlan")}</Link> {t("toInviteMore")}
            </p>
          )}
        </div>
      </Section>

      {/* Pending invitations */}
      {pendingInvites.length > 0 && (
        <Section title={t("pendingTitle")} bordered>
          <div className="divide-y divide-border">
            {pendingInvites.map((inv) => (
              <div key={inv.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="m-0 truncate text-sm font-medium text-foreground">{inv.email}</p>
                    <Badge variant="secondary">{t("pendingBadge")}</Badge>
                  </div>
                  <p className="m-0 mt-0.5 text-[13px] leading-5 text-muted-foreground">
                    {t(`roleLabels.${inv.role}`)}
                  </p>
                </div>
                {canInvite && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={inviteBusyEmail === inv.email}
                      onClick={() => invite(inv.email, inv.role)}
                    >
                      {t("resend")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-mk-neg"
                      disabled={inviteBusyEmail === inv.email}
                      onClick={() => revokeInvite(inv.email)}
                    >
                      {t("revoke")}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Roles reference */}
      <Section title={t("roles.title")} description={t("roles.description")} bordered>
        <div className="divide-y divide-border">
          {(["owner", "admin", "member", "analyst"] as const).map((role) => (
            <SettingsRow key={role} title={t(`roleLabels.${role}`)} description={roleDescriptions[role]} />
          ))}
        </div>
      </Section>

      <ConfirmDeleteDialog
        open={!!removeTarget}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
        entity="teamMember"
        name={removeTarget?.email}
        confirmLabel={t("removeDialog.confirmLabel")}
        warning={t("removeDialog.warning")}
        onConfirm={confirmRemoveMember}
      />

      {/* Transfer ownership */}
      <Dialog open={!!transferTarget} onOpenChange={(open) => { if (!open) setTransferTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("transferDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("transferDialog.description", { email: transferTarget?.email ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferTarget(null)} disabled={transferring}>
              {t("transferDialog.cancel")}
            </Button>
            <Button onClick={confirmTransferOwnership} disabled={transferring}>
              {transferring ? <Loader2 className="size-4 animate-spin" /> : t("transferDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  const [leaveTarget, setLeaveTarget] = useState<WorkspaceRow | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceRow | null>(null);

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
        await refresh({ select: res.data.id, hint: { name: newName.trim(), role: 'owner' } });
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

  async function confirmLeaveWorkspace() {
    if (!leaveTarget) return;
    setLeaving(true);
    try {
      const res = await apiFetch(`/api/team/leave?workspaceId=${leaveTarget.id}`, { method: 'POST' });
      if (res.ok) {
        toast.success(t("toasts.left", { name: leaveTarget.name }));
        setLeaveTarget(null);
        await refresh();
        invalidateQueries();
      } else {
        toast.error(t("toasts.leaveFailed"));
      }
    } catch {
      toast.error(t("toasts.somethingWrong"));
    } finally {
      setLeaving(false);
    }
  }

  async function confirmDeleteWorkspace() {
    if (!deleteTarget) return;
    try {
      const res = await apiFetch(`/api/workspaces/${deleteTarget.id}?workspaceId=${deleteTarget.id}`, {
        method: 'DELETE',
        timeoutMs: DESTRUCTIVE_REQUEST_TIMEOUT_MS,
      });
      if (res.ok) {
        toast.success(t("toasts.deleted", { name: deleteTarget.name }));
        await refresh();
        invalidateQueries();
      } else {
        toast.error(t("toasts.deleteFailed"));
      }
    } catch {
      toast.error(t("toasts.somethingWrong"));
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-8">
      <Section
        title={t("title")}
        description={
          limit === -1
            ? t("unlimitedWorkspaces", { plan: plan.name })
            : t("ownedCount", { count: ownedCount, limit, plan: plan.name })
        }
        bordered
      >
        <div className="divide-y divide-border">
          {workspaces.map((ws) => (
            <div key={ws.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
                  <span className="text-xs font-semibold text-mk-ink-80">{ws.name.slice(0, 2).toUpperCase()}</span>
                </div>
                <div className="min-w-0 flex-1">
                  {editingId === ws.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') renameWorkspace(ws.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="h-8 max-w-[320px]"
                        aria-label={t("namePlaceholder")}
                        autoFocus
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => renameWorkspace(ws.id)}
                        disabled={saving}
                      >
                        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex min-w-0 items-center gap-1">
                        <p className="m-0 truncate text-sm font-medium text-foreground">{ws.name}</p>
                        {ws.role === 'owner' && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-mk-ink-40 hover:text-foreground"
                            onClick={() => { setEditingId(ws.id); setEditName(ws.name); }}
                          >
                            <Pencil className="size-3" />
                          </Button>
                        )}
                      </div>
                      <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t(`roleLabels.${ws.role}`)}</p>
                    </>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {ws.id === current?.id ? (
                  <Badge variant="accent">{t("active")}</Badge>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => switchWorkspace(ws.id)}>
                    {t("switch")}
                  </Button>
                )}
                {ws.role !== 'owner' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-mk-neg"
                    onClick={() => setLeaveTarget(ws)}
                  >
                    {t("leave")}
                  </Button>
                )}
                {ws.role === 'owner' && workspaces.length > 1 && (
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="text-mk-neg"
                    onClick={() => setDeleteTarget(ws)}
                    aria-label={t("deleteAria", { name: ws.name })}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}

          {/* Create workspace */}
          {canCreate && (
            <div className="px-4 py-4 sm:px-5">
              <FormField label={t("createLabel")} htmlFor="workspace-new-name">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="workspace-new-name"
                    placeholder={t("namePlaceholder")}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createWorkspace()}
                    className="flex-1 sm:max-w-[360px]"
                  />
                  <Button onClick={createWorkspace} disabled={creating || !newName.trim()}>
                    {creating ? t("creating") : t("create")}
                  </Button>
                </div>
              </FormField>
            </div>
          )}

          {!canCreate && (
            <p className="m-0 px-4 py-3 text-[13px] leading-5 text-muted-foreground sm:px-5">
              {t("limitReached")}{' '}
              <Link href="/settings?tab=billing" className="text-mk-accent hover:underline">{t("upgradePlan")}</Link> {t("toCreateMore")}
            </p>
          )}
        </div>
      </Section>

      {/* Leave workspace */}
      <Dialog open={!!leaveTarget} onOpenChange={(open) => { if (!open) setLeaveTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("leaveDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("leaveDialog.description", { name: leaveTarget?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveTarget(null)} disabled={leaving}>
              {t("leaveDialog.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmLeaveWorkspace} disabled={leaving}>
              {leaving ? <Loader2 className="size-4 animate-spin" /> : t("leaveDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete workspace — typed confirmation, it removes everything */}
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        entity="workspace"
        name={deleteTarget?.name}
        requireTypedConfirmation
        warning={t("deleteDialog.warning")}
        onConfirm={confirmDeleteWorkspace}
      />
    </div>
  );
}

/* ─── API Access Tab ───────────────────────────────────────────────────── */

/** Scope / event checklist used by the create and edit dialogs. */
function ScopeChecklist({
  options,
  selected,
  onToggle,
  labelFor,
}: {
  options: readonly { id: string; labelKey: string }[];
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
  labelFor: (labelKey: string) => string;
}) {
  return (
    <div className="grid gap-2.5 rounded-xl border border-border p-3">
      {options.map((option) => (
        <Label key={option.id} className="justify-start gap-2.5">
          <Checkbox
            checked={selected.includes(option.id)}
            onCheckedChange={(checked) => onToggle(option.id, checked === true)}
          />
          <span>{labelFor(option.labelKey)}</span>
          <span className="font-mono text-xs text-mk-ink-40">{option.id}</span>
        </Label>
      ))}
    </div>
  );
}

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
  const [sendingTestWebhook, setSendingTestWebhook] = useState<string | null>(null);

  // Delivery history for one endpoint, loaded on demand. Attempts, response
  // codes, and retry state have always been recorded and never shown, so an
  // endpoint that has been 500-ing for a week looked identical to a healthy
  // one.
  const [deliveriesEndpoint, setDeliveriesEndpoint] = useState<WebhookEndpointInfo | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryInfo[]>([]);
  const [deliveriesCursor, setDeliveriesCursor] = useState<string | null>(null);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesError, setDeliveriesError] = useState<string | null>(null);

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

  async function loadDeliveries(endpoint: WebhookEndpointInfo, cursor?: string) {
    setDeliveriesLoading(true);
    setDeliveriesError(null);
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const res = await apiGet<{ deliveries: WebhookDeliveryInfo[]; nextCursor: string | null }>(
        `/api/settings/webhook-endpoints/${endpoint.id}/deliveries${query}`,
        wsId,
      );
      if (!res.ok) {
        setDeliveriesError(userFacingError(res.data, t("webhooksSection.deliveriesDialog.loadFailed")));
        return;
      }
      setDeliveries((prev) => (cursor ? [...prev, ...res.data.deliveries] : res.data.deliveries));
      setDeliveriesCursor(res.data.nextCursor);
    } catch {
      setDeliveriesError(t("webhooksSection.deliveriesDialog.loadFailed"));
    } finally {
      setDeliveriesLoading(false);
    }
  }

  function openDeliveries(endpoint: WebhookEndpointInfo) {
    setDeliveriesEndpoint(endpoint);
    setDeliveries([]);
    setDeliveriesCursor(null);
    setDeliveriesError(null);
    void loadDeliveries(endpoint);
  }

  async function sendWebhookTest(id: string) {
    setSendingTestWebhook(id);
    try {
      // Queues one signed delivery through the real pipeline (5.11): the
      // fastest way to confirm signature verification works is to receive an
      // actual delivery on demand.
      const res = await apiPost(`/api/settings/webhook-endpoints/${id}/test`, {}, wsId);
      if (res.ok) {
        toast.success(t("webhooksSection.testSent"));
      } else {
        toast.error(userFacingError(res.data, t("webhooksSection.testFailed")));
      }
    } catch {
      toast.error(t("webhooksSection.testFailed"));
    } finally {
      setSendingTestWebhook(null);
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
      <Notice tone="neutral" icon={KeyRound} title={t("restricted.title")}>
        {t("restricted.description")}
      </Notice>
    );
  }

  // Archived keys (revoked + archived) are hidden from the list by default so
  // the active key roster stays readable; the "Show archived" toggle reveals them.
  const archivedClientCount = apiClientUsage.filter((client) => client.archived).length;
  const visibleClients = showArchived
    ? apiClientUsage
    : apiClientUsage.filter((client) => !client.archived);

  const archivedToggle = archivedClientCount > 0 ? (
    <Button variant="ghost" size="sm" onClick={() => setShowArchived((prev) => !prev)}>
      <Archive className="size-3.5" />
      {showArchived ? t("keysSection.hideArchived") : t("keysSection.showArchived", { count: archivedClientCount })}
    </Button>
  ) : null;

  return (
    <div className="space-y-8">
      <Section
        title={t("title")}
        description={t("description")}
        action={
          <>
            <Button variant="outline" size="sm" asChild>
              <a href="/developers/api" target="_blank" rel="noopener noreferrer">
                <BookOpen className="size-3.5" />
                {t("viewDocs")}
              </a>
            </Button>
            <Button size="sm" onClick={() => setCreateKeyOpen(true)}>
              {t("createKey")}
            </Button>
          </>
        }
      >
        <StatGrid columns={4}>
          <StatTile
            label={t("stats.requestsThisMonth")}
            value={usageTotals.currentMonthRequests.toLocaleString(locale)}
            sub={formatMonthKey(apiClientUsage[0]?.usage.currentMonth || new Date().toISOString().slice(0, 7), locale)}
            loading={loading}
          />
          <StatTile
            label={t("stats.queuedPublishes")}
            value={usageTotals.publishQueued.toLocaleString(locale)}
            sub={t("stats.allKeysInWorkspace")}
            loading={loading}
          />
          <StatTile
            label={t("stats.completedOutcomes")}
            value={(usageTotals.publishSucceeded + usageTotals.publishActionRequired).toLocaleString(locale)}
            sub={loading
              ? t("stats.outcomesLoading")
              : t("stats.outcomesBreakdown", { succeeded: usageTotals.publishSucceeded.toLocaleString(locale), actionRequired: usageTotals.publishActionRequired.toLocaleString(locale) })}
            loading={loading}
          />
          <StatTile
            label={t("stats.failures")}
            value={usageTotals.publishFailed.toLocaleString(locale)}
            sub={t("stats.trackedAtCompletion")}
            loading={loading}
          />
        </StatGrid>
      </Section>

      {/* API keys */}
      <Section
        title={t("keysSection.title")}
        description={t("keysSection.description")}
        action={archivedToggle ?? undefined}
        bordered
      >
        {loading ? (
          <RowSkeletons rows={3} />
        ) : visibleClients.length === 0 ? (
          <EmptyState
            compact
            icon={KeyRound}
            title={apiClientUsage.length === 0 ? t("keysSection.empty") : t("keysSection.emptyFiltered")}
            className="rounded-none border-0"
            action={
              apiClientUsage.length === 0 ? (
                <Button size="sm" onClick={() => setCreateKeyOpen(true)}>{t("createKey")}</Button>
              ) : (
                archivedToggle
              )
            }
          />
        ) : (
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
              {visibleClients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="min-w-[220px] align-top">
                    <div className="space-y-2">
                      <div>
                        <p className="m-0 font-medium text-foreground">{client.name}</p>
                        <p className="m-0 font-mono text-xs text-muted-foreground">{client.keyPrefix}…</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {client.productId && (
                          <Badge variant="outline">
                            {t("keysSection.brandBadge", { name: productNameById(client.productId) ?? "" })}
                          </Badge>
                        )}
                        {client.origin === 'oauth' && (
                          <Badge variant="secondary">
                            {t("keysSection.agentBadge")}
                          </Badge>
                        )}
                      </div>
                      <ApiTrendBars points={client.trend} requestsLabel={t("keysSection.requestsThisMonth")} />
                      <p className="m-0 text-xs text-mk-ink-40">{t("keysSection.trendCaption")}</p>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-[180px] align-top">
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p className="m-0"><span className="font-medium text-foreground tabular-nums">{(client.usage.currentMonthCounts.request || 0).toLocaleString(locale)}</span> {t("keysSection.requestsThisMonth")}</p>
                      <p className="m-0"><span className="font-medium text-foreground tabular-nums">{client.usage.totalRequests.toLocaleString(locale)}</span> {t("keysSection.totalRequests")}</p>
                      <p className="m-0">{t("keysSection.uploadsAndPosts", { uploads: (client.usage.currentMonthCounts.media_upload || 0).toLocaleString(locale), posts: (client.usage.currentMonthCounts.post_create || 0).toLocaleString(locale) })}</p>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-[200px] align-top">
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p className="m-0"><span className="font-medium text-foreground tabular-nums">{(client.usage.currentMonthCounts.publish_queued || 0).toLocaleString(locale)}</span> {t("keysSection.queued")}</p>
                      <p className="m-0"><span className="font-medium text-mk-pos tabular-nums">{(client.usage.currentMonthCounts.publish_succeeded || 0).toLocaleString(locale)}</span> {t("keysSection.directPublish")}</p>
                      <p className="m-0"><span className="font-medium text-mk-warn tabular-nums">{((client.usage.currentMonthCounts.publish_action_required || 0) + (client.usage.currentMonthCounts.publish_exported_for_review || 0)).toLocaleString(locale)}</span> {t("keysSection.actionRequired")}</p>
                      <p className="m-0"><span className="font-medium text-mk-neg tabular-nums">{(client.usage.currentMonthCounts.publish_failed || 0).toLocaleString(locale)}</span> {t("keysSection.failed")}</p>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[320px] whitespace-normal align-top">
                    <div className="flex flex-wrap gap-1.5">
                      {client.scopes.map((scope) => (
                        <Badge key={scope} variant="outline" className="font-mono font-normal">{scope}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-col items-start gap-1.5">
                      <Status value={client.status} label={t(`keysSection.statusLabels.${client.status}`)} />
                      {client.archived && (
                        <Badge variant="secondary">{t("keysSection.archivedBadge")}</Badge>
                      )}
                      {client.expiresAt ? (
                        new Date(client.expiresAt).getTime() <= nowAtMount ? (
                          <Badge variant="negative">{t("keysSection.expiredBadge")}</Badge>
                        ) : (
                          <p className="m-0 text-xs text-muted-foreground">{t("keysSection.expires", { date: formatShortDate(client.expiresAt, locale) })}</p>
                        )
                      ) : (
                        <p className="m-0 text-xs text-muted-foreground">{t("keysSection.neverExpires")}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    {client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleString(locale) : t("keysSection.never")}
                  </TableCell>
                  <TableCell className="align-top text-end">
                    <div className="flex justify-end gap-1">
                      {client.archived ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => archiveClient(client.id, false)}
                          disabled={archivingClient === client.id}
                        >
                          <ArchiveRestore className="size-3.5" />
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
                            <Pencil className="size-3.5" />
                            {t("keysSection.editPermissions")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRotateTarget(client)}
                            disabled={client.status !== 'active' || rotatingClient}
                          >
                            <RefreshCw className="size-3.5" />
                            {t("keysSection.rotate")}
                          </Button>
                          {client.status === 'revoked' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => archiveClient(client.id, true)}
                              disabled={archivingClient === client.id}
                            >
                              <Archive className="size-3.5" />
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
                              <Trash2 className="size-3.5" />
                              {revokingClient === client.id ? t("keysSection.revoking") : t("keysSection.revoke")}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {/* Webhook endpoints */}
      <Section
        title={t("webhooksSection.title")}
        description={t("webhooksSection.description")}
        action={
          <Button variant="outline" size="sm" onClick={() => setCreateWebhookOpen(true)}>
            <Webhook className="size-3.5" />
            {t("webhooksSection.addWebhook")}
          </Button>
        }
        bordered
      >
        {loading ? (
          <RowSkeletons rows={2} />
        ) : webhookEndpoints.length === 0 ? (
          <EmptyState
            compact
            icon={Webhook}
            title={t("webhooksSection.empty")}
            className="rounded-none border-0"
            action={
              <Button variant="outline" size="sm" onClick={() => setCreateWebhookOpen(true)}>
                {t("webhooksSection.addWebhook")}
              </Button>
            }
          />
        ) : (
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
              {webhookEndpoints.map((endpoint) => (
                <TableRow key={endpoint.id}>
                  <TableCell className="max-w-[320px] whitespace-normal align-top">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0">
                        <p className="m-0 break-all font-medium text-foreground">{endpoint.url}</p>
                        <p className="m-0 text-xs text-muted-foreground">{t("webhooksSection.created", { date: new Date(endpoint.createdAt).toLocaleString(locale) })}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="shrink-0 text-mk-ink-40 hover:text-foreground"
                        onClick={() => copyText(endpoint.url, t("toasts.webhookUrlCopied"), t("toasts.webhookUrlCopyFailed"))}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[320px] whitespace-normal align-top">
                    <div className="flex flex-wrap gap-1.5">
                      {endpoint.events.map((eventName) => (
                        <Badge key={eventName} variant="outline" className="font-mono font-normal">{eventName}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="space-y-1.5">
                      <Status value={endpoint.status} label={t(`webhooksSection.statusLabels.${endpoint.status}`)} />
                      {endpoint.health && (
                        <div className="text-xs text-muted-foreground">
                          {endpoint.health.delivered24h === 0 && endpoint.health.failed24h === 0 ? (
                            <p className="m-0">{t("webhooksSection.health.quiet")}</p>
                          ) : (
                            <p className="m-0 flex flex-wrap items-center gap-x-2">
                              <span>{t("webhooksSection.health.delivered", { count: endpoint.health.delivered24h })}</span>
                              <span className={endpoint.health.failed24h > 0 ? "text-mk-neg" : undefined}>
                                {t("webhooksSection.health.failed", { count: endpoint.health.failed24h })}
                              </span>
                              <span>{t("webhooksSection.health.window")}</span>
                            </p>
                          )}
                          <p className="m-0">
                            {endpoint.health.lastSuccessAt
                              ? t("webhooksSection.health.lastSuccess", { date: new Date(endpoint.health.lastSuccessAt).toLocaleString(locale) })
                              : t("webhooksSection.health.lastSuccessNever")}
                          </p>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-end">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => sendWebhookTest(endpoint.id)}
                        disabled={endpoint.status !== 'active' || sendingTestWebhook === endpoint.id}
                      >
                        {sendingTestWebhook === endpoint.id
                          ? t("webhooksSection.sendingTest")
                          : t("webhooksSection.sendTest")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDeliveries(endpoint)}
                      >
                        {t("webhooksSection.deliveries")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-mk-neg hover:text-mk-neg"
                        onClick={() => disableWebhook(endpoint.id)}
                        disabled={endpoint.status !== 'active' || disablingWebhook === endpoint.id}
                      >
                        {disablingWebhook === endpoint.id ? t("webhooksSection.disabling") : t("webhooksSection.disable")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {/* Operational notes */}
      <Section title={t("operationalNotes.title")} description={t("operationalNotes.description")} bordered>
        <div className="divide-y divide-border">
          <SettingsRow title={t("infoCards.videoSupportTitle")} description={t("infoCards.videoSupportDescription")} />
          <SettingsRow title={t("infoCards.mediaCapsTitle")} description={t("infoCards.mediaCapsDescription")} />
          <SettingsRow title={t("infoCards.inboxTitle")} description={t("infoCards.inboxDescription")} />
          <SettingsRow title={t("operationalNotes.rateLimitTitle")} description={t("operationalNotes.rateLimitDescription")} />
          <SettingsRow title={t("operationalNotes.webhookSecretTitle")} description={t("operationalNotes.webhookSecretDescription")} />
          <SettingsRow title={t("operationalNotes.asyncTitle")} description={t("operationalNotes.asyncDescription")} />
          <SettingsRow title={t("operationalNotes.tiktokInboxTitle")} description={t("operationalNotes.tiktokInboxDescription")} />
        </div>
      </Section>

      <Dialog open={createKeyOpen} onOpenChange={setCreateKeyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createKeyDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("createKeyDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label={t("createKeyDialog.nameLabel")} htmlFor="api-client-name">
              <Input id="api-client-name" placeholder={t("createKeyDialog.namePlaceholder")} value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </FormField>
            <FormField label={t("createKeyDialog.expiresLabel")} htmlFor="api-client-expiry">
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
            </FormField>
            <FormField
              label={t("createKeyDialog.brandLabel")}
              htmlFor="api-client-product"
              description={products.length === 0
                ? t("createKeyDialog.brandHelpEmpty")
                : t("createKeyDialog.brandHelpRequired")}
            >
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
            </FormField>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>{t("createKeyDialog.scopesLabel")}</Label>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  onClick={() =>
                    setSelectedScopes(
                      selectedScopes.length === API_SCOPE_OPTIONS.length
                        ? []
                        : API_SCOPE_OPTIONS.map((scope) => scope.id),
                    )
                  }
                >
                  {selectedScopes.length === API_SCOPE_OPTIONS.length ? t("createKeyDialog.clearAll") : t("createKeyDialog.selectAll")}
                </Button>
              </div>
              <ScopeChecklist
                options={API_SCOPE_OPTIONS}
                selected={selectedScopes}
                onToggle={(id, checked) => setSelectedScopes((current) => toggleSelection(current, id, checked))}
                labelFor={(labelKey) => t(`scopes.${labelKey}`)}
              />
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

      <Dialog
        open={Boolean(deliveriesEndpoint)}
        onOpenChange={(open) => { if (!open) setDeliveriesEndpoint(null); }}
      >
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>{t("webhooksSection.deliveriesDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("webhooksSection.deliveriesDialog.description")}
            </DialogDescription>
          </DialogHeader>
          {deliveriesEndpoint && (
            <p className="m-0 break-all font-mono text-xs text-muted-foreground">{deliveriesEndpoint.url}</p>
          )}
          <div className="max-h-[420px] overflow-y-auto rounded-xl border border-border">
            {deliveries.length === 0 && !deliveriesLoading ? (
              deliveriesError ? (
                <Notice tone="negative" className="rounded-none border-0">{deliveriesError}</Notice>
              ) : (
                <EmptyState compact title={t("webhooksSection.deliveriesDialog.empty")} className="rounded-none border-0" />
              )
            ) : deliveries.length === 0 ? (
              <RowSkeletons rows={3} control={false} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("webhooksSection.deliveriesDialog.columns.event")}</TableHead>
                    <TableHead>{t("webhooksSection.deliveriesDialog.columns.status")}</TableHead>
                    <TableHead>{t("webhooksSection.deliveriesDialog.columns.attempts")}</TableHead>
                    <TableHead>{t("webhooksSection.deliveriesDialog.columns.response")}</TableHead>
                    <TableHead>{t("webhooksSection.deliveriesDialog.columns.when")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveries.map((delivery) => (
                    <TableRow key={delivery.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{delivery.eventType}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            delivery.status === 'delivered' ? "positive"
                              : delivery.status === 'failed' ? "negative"
                                : "secondary"
                          }
                        >
                          {delivery.status}
                        </Badge>
                        {/* Truncated server-side; provider response bodies are
                            never rendered in full. */}
                        {delivery.lastError && (
                          <p className="m-0 mt-1 max-w-[220px] whitespace-normal break-words text-xs text-muted-foreground">
                            {delivery.lastError}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">{delivery.attemptCount}</TableCell>
                      <TableCell className="tabular-nums">{delivery.responseCode ?? "n/a"}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {delivery.lastAttemptAt
                          ? new Date(delivery.lastAttemptAt).toLocaleString(locale)
                          : delivery.createdAt
                            ? new Date(delivery.createdAt).toLocaleString(locale)
                            : "n/a"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            {deliveriesCursor && deliveriesEndpoint && (
              <Button
                variant="outline"
                onClick={() => loadDeliveries(deliveriesEndpoint, deliveriesCursor)}
                disabled={deliveriesLoading}
              >
                {deliveriesLoading
                  ? t("webhooksSection.deliveriesDialog.loading")
                  : t("webhooksSection.deliveriesDialog.loadMore")}
              </Button>
            )}
            <Button onClick={() => setDeliveriesEndpoint(null)}>
              {t("webhooksSection.deliveriesDialog.close")}
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
            <FormField label={t("createWebhookDialog.urlLabel")} htmlFor="webhook-url">
              <Input id="webhook-url" placeholder={t("createWebhookDialog.urlPlaceholder")} value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
            </FormField>
            <div className="space-y-2">
              <Label>{t("createWebhookDialog.eventsLabel")}</Label>
              <ScopeChecklist
                options={WEBHOOK_EVENT_OPTIONS}
                selected={selectedEvents}
                onToggle={(id, checked) => setSelectedEvents((current) => toggleSelection(current, id, checked))}
                labelFor={(labelKey) => t(`webhookEvents.${labelKey}`)}
              />
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
            <div className="rounded-lg bg-muted px-3 py-2.5">
              <p className="m-0 text-sm font-medium text-foreground">{editingClient?.name || t("editKeyDialog.fallbackName")}</p>
              <p className="m-0 mt-0.5 font-mono text-xs text-muted-foreground">{editingClient?.keyPrefix}…</p>
            </div>
            <div className="space-y-2">
              <Label>{t("editKeyDialog.scopesLabel")}</Label>
              <ScopeChecklist
                options={API_SCOPE_OPTIONS}
                selected={editingScopes}
                onToggle={(id, checked) => setEditingScopes((current) => toggleSelection(current, id, checked))}
                labelFor={(labelKey) => t(`scopes.${labelKey}`)}
              />
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
          <div className="rounded-lg bg-muted px-3 py-2.5">
            <p className="m-0 text-sm font-medium text-foreground">{rotateTarget?.name || t("rotateKeyDialog.fallbackName")}</p>
            <p className="m-0 mt-0.5 font-mono text-xs text-muted-foreground">{rotateTarget?.keyPrefix}…</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotateTarget(null)} disabled={rotatingClient}>{t("rotateKeyDialog.cancel")}</Button>
            <Button onClick={rotateClient} disabled={rotatingClient}>
              {rotatingClient && <Loader2 className="size-4 animate-spin" />}
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
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted p-3">
              <code className="break-all font-mono text-xs text-foreground">{createdApiKey}</code>
            </div>
            <a href="/developers/api" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-mk-accent hover:underline">
              {t("createdKeyDialog.reviewGuide")}
              <ExternalLink className="size-3.5" />
            </a>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatedApiKey(null)}>{t("createdKeyDialog.close")}</Button>
            <Button onClick={() => createdApiKey && copyText(createdApiKey, t("toasts.apiKeyCopied"), t("toasts.apiKeyCopyFailed"))}>
              <Copy className="size-3.5" />
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
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted p-3">
              <code className="break-all font-mono text-xs text-foreground">{createdWebhookSecret}</code>
            </div>
            <p className="m-0 text-[13px] leading-5 text-muted-foreground">
              {t("createdWebhookDialog.headerNote")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatedWebhookSecret(null)}>{t("createdWebhookDialog.close")}</Button>
            <Button onClick={() => createdWebhookSecret && copyText(createdWebhookSecret, t("toasts.webhookSecretCopied"), t("toasts.webhookSecretCopyFailed"))}>
              <Copy className="size-3.5" />
              {t("createdWebhookDialog.copySecret")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Billing Tab ──────────────────────────────────────────────────────── */

type AddonInfo = {
  key: "brand" | "seat";
  name: string;
  price: { monthly: number; annual: number };
  quantity: number;
  available: boolean;
};

function AddonsCard({ interval, tier, workspaceId }: { interval: string | null; tier: PlanTier; workspaceId?: string }) {
  const t = useTranslations("settings.billing.addons");
  const [addons, setAddons] = useState<AddonInfo[] | null>(null);
  const [pending, setPending] = useState<Record<string, number>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiGet<{ addons: AddonInfo[] }>("/api/stripe/addons", workspaceId);
    if (res.ok) {
      setAddons(res.data.addons);
      setPending({});
    }
  }, [workspaceId]);

  useEffect(() => {
    deferFromEffect(load);
  }, [load]);

  const available = (addons ?? []).filter((a) => a.available);
  if (!addons || available.length === 0) return null;

  const annual = interval === "annual";
  const baseLimits = PLANS[tier].limits;

  async function update(addon: AddonInfo, quantity: number) {
    setBusyKey(addon.key);
    try {
      const res = await apiPost<{ ok: boolean }>("/api/stripe/addons", {
        addon: addon.key,
        quantity,
      }, workspaceId);
      if (res.ok) {
        toast.success(t("toastUpdated"));
        await load();
      } else {
        toast.error(t("toastFailed"));
      }
    } catch {
      toast.error(t("toastFailed"));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Section title={t("title")} description={t("description")} bordered>
      <div className="divide-y divide-border">
        {available.map((addon) => {
          const qty = pending[addon.key] ?? addon.quantity;
          const dirty = qty !== addon.quantity;
          const total = addon.key === "brand" ? baseLimits.brands + qty : baseLimits.teamMembers + qty;
          return (
            <SettingsRow
              key={addon.key}
              title={t(`names.${addon.key}`)}
              description={
                <>
                  {annual
                    ? t("pricePerYear", { price: addon.price.annual })
                    : t("pricePerMonth", { price: addon.price.monthly })}
                  {" · "}
                  {addon.key === "brand" ? t("totalBrands", { total }) : t("totalSeats", { total })}
                </>
              }
            >
              <Button
                variant="outline"
                size="icon-sm"
                disabled={qty <= 0 || busyKey !== null}
                onClick={() => setPending((p) => ({ ...p, [addon.key]: Math.max(0, qty - 1) }))}
              >
                <Minus className="size-3.5" />
              </Button>
              <span className="mk-figure w-8 text-center text-sm font-medium tabular-nums text-foreground">{qty}</span>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={qty >= 100 || busyKey !== null}
                onClick={() => setPending((p) => ({ ...p, [addon.key]: Math.min(100, qty + 1) }))}
              >
                <Plus className="size-3.5" />
              </Button>
              {dirty && (
                <Button size="sm" disabled={busyKey !== null} onClick={() => update(addon, qty)}>
                  {busyKey === addon.key ? t("updating") : t("update")}
                </Button>
              )}
            </SettingsRow>
          );
        })}
        <p className="m-0 px-4 py-3 text-[13px] leading-5 text-muted-foreground sm:px-5">{t("prorationNote")}</p>
      </div>
    </Section>
  );
}

/** /api/stripe/status payload (SubscriptionStatus + `billable`). */
type BillingStatusInfo = {
  active: boolean;
  tier: PlanTier | null;
  interval: string | null;
  /** True only when the workspace subscription has a real Stripe customer. */
  billable: boolean;
};

const PLAN_RANK: Record<string, number> = Object.fromEntries(
  PLAN_TIERS.map((tier, idx) => [tier, idx + 1]),
);

type PlanChangeKind = "upgrade" | "downgrade" | "interval";

/**
 * Checkout failures used to collapse into one generic toast, which made a 401
 * (expired session) and a 403 (not the owner of the resolved workspace) look
 * identical to "Stripe is broken". Name them instead.
 */
function checkoutErrorMessage(
  status: number,
  error: string | undefined,
  t: (key: string) => string,
): string {
  if (status === 401) return t("changePlan.toastSignedOut");
  if (status === 403) return t("changePlan.toastNotOwner");
  if (error === "Price not configured" || error === "Price unavailable") {
    return t("changePlan.toastPriceMissing");
  }
  return t("changePlan.toastFailed");
}

function BillingTab() {
  const t = useTranslations("settings.billing");
  const locale = useLocale();
  const { status, trialDaysLeft, refresh } = useSubscription();
  const { current: workspace } = useWorkspace();
  const workspaceId = workspace?.id;
  const [busy, setBusy] = useState(false);
  // Live billing status straight from the API — the provider's bootstrap copy
  // lacks `billable`, which decides portal access vs. the checkout fallback.
  const [billing, setBilling] = useState<BillingStatusInfo | null>(null);
  const [pageInterval, setPageInterval] = useState<BillingInterval>("annual");
  const [confirmTarget, setConfirmTarget] = useState<{ tier: PlanTier; kind: PlanChangeKind } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string[] | null>(null);
  const [checkoutTier, setCheckoutTier] = useState<PlanTier | null>(null);
  // Bumped to remount AddonsCard after a plan change (availability is per tier).
  const [addonsRefreshKey, setAddonsRefreshKey] = useState(0);

  // Every billing call names the workspace explicitly: billing is per-workspace,
  // and a workspace-blind request is resolved server-side from the cookie, which
  // can lag the switcher (or be missing entirely on a fresh session). Reading or
  // charging the wrong workspace is the failure mode this avoids.
  const loadBilling = useCallback(async () => {
    const res = await apiGet<BillingStatusInfo>("/api/stripe/status", workspaceId);
    if (res.ok) setBilling(res.data);
  }, [workspaceId]);

  // Keyed on workspaceId so switching workspaces re-reads that workspace's
  // plan instead of leaving the previous one's card on screen.
  useEffect(() => {
    deferFromEffect(loadBilling);
  }, [loadBilling]);

  // Seed the interval toggle from the live subscription. Render-time sync
  // (not an effect) so a late status fetch or a completed interval switch
  // re-aligns the toggle in a single pass.
  const liveInterval = billing?.interval ?? status?.interval ?? null;
  const [seededInterval, setSeededInterval] = useState<string | null>(null);
  if (liveInterval !== seededInterval) {
    setSeededInterval(liveInterval);
    if (liveInterval === "monthly" || liveInterval === "annual") setPageInterval(liveInterval);
  }

  if (!status) return null;

  const tier = (status.tier ?? 'free') as PlanTier;
  const plan = PLANS[tier];
  const canManageBilling = workspace?.role === 'owner';
  // A real, chargeable subscription that /api/stripe/change-plan can switch
  // in place; anything else (free, comped, lapsed) goes through checkout.
  const billableActive = Boolean(billing?.active && billing.billable);

  async function openPortal() {
    setBusy(true);
    try {
      const res = await apiPost<{ url: string }>("/api/stripe/portal", {}, workspaceId);
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

  // No live Stripe subscription to modify (free tier, comped, lapsed):
  // start a checkout session instead — same flow onboarding uses.
  async function startCheckout(target: PlanTier, interval: BillingInterval) {
    setCheckoutTier(target);
    try {
      const res = await apiPost<{ url: string; error?: string }>("/api/stripe/checkout", {
        tier: target,
        interval,
        // Backing out of Stripe returns to the billing tab, not the onboarding
        // quiz — which is where an unnamed origin defaults to.
        returnTo: "/settings?tab=billing",
      }, workspaceId);
      if (res.ok && res.data.url) {
        window.location.assign(res.data.url);
        return;
      }
      toast.error(checkoutErrorMessage(res.status, res.data?.error, t));
    } catch {
      toast.error(t("changePlan.toastFailed"));
    }
    setCheckoutTier(null);
  }

  function openConfirm(target: PlanTier, kind: PlanChangeKind) {
    setConfirmError(null);
    setConfirmTarget({ tier: target, kind });
  }

  function closeConfirm() {
    setConfirmTarget(null);
    setConfirmError(null);
  }

  async function applyPlanChange() {
    if (!confirmTarget) return;
    const targetPlan = PLANS[confirmTarget.tier];
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      const res = await apiPost<{ ok?: boolean }>("/api/stripe/change-plan", {
        tier: confirmTarget.tier,
        interval: pageInterval,
      }, workspaceId);
      if (res.ok) {
        toast.success(t("changePlan.toastChanged", { plan: targetPlan.name }));
        closeConfirm();
        setAddonsRefreshKey((k) => k + 1);
        await Promise.all([loadBilling(), refresh()]);
        return;
      }
      const data = res.data as {
        error?: string;
        addons?: ("brand" | "seat")[];
        details?: Partial<Record<"brands" | "teamMembers" | "workspaces", { current: number; allowed: number }>>;
      } | null;
      if (res.status === 404 && data?.error === "NO_BILLING_ACCOUNT") {
        // Server says there's nothing to switch in place — fall back to checkout.
        const target = confirmTarget.tier;
        closeConfirm();
        await startCheckout(target, pageInterval);
        return;
      }
      if (res.status === 409 && data?.error === "ADDONS_NOT_AVAILABLE_ON_TIER") {
        const addons = data.addons ?? [];
        setConfirmError([
          t("changePlan.addonsBlocked", {
            plan: targetPlan.name,
            count: addons.length,
            addons: addons.map((key) => t(`addons.names.${key}`)).join(", "),
          }),
        ]);
        return;
      }
      if (res.status === 409 && data?.error === "PLAN_DOWNGRADE_BLOCKED") {
        const d = data.details ?? {};
        setConfirmError([
          t("changePlan.downgradeBlocked", { plan: targetPlan.name }),
          ...(d.brands ? [t("changePlan.blockedBrands", d.brands)] : []),
          ...(d.teamMembers ? [t("changePlan.blockedTeamMembers", d.teamMembers)] : []),
          ...(d.workspaces ? [t("changePlan.blockedWorkspaces", d.workspaces)] : []),
        ]);
        return;
      }
      setConfirmError([t("changePlan.toastFailed")]);
    } catch {
      setConfirmError([t("changePlan.toastFailed")]);
    } finally {
      setConfirmBusy(false);
    }
  }

  const confirmPlanName = confirmTarget ? PLANS[confirmTarget.tier].name : "";
  const confirmTitle = !confirmTarget
    ? ""
    : confirmTarget.kind === "upgrade"
    ? t("changePlan.confirmTitleUpgrade", { plan: confirmPlanName })
    : confirmTarget.kind === "downgrade"
    ? t("changePlan.confirmTitleDowngrade", { plan: confirmPlanName })
    : pageInterval === "annual"
    ? t("changePlan.confirmTitleAnnual")
    : t("changePlan.confirmTitleMonthly");
  const confirmBody = !confirmTarget
    ? ""
    : confirmTarget.kind === "upgrade"
    ? t("changePlan.confirmBodyUpgrade", { plan: confirmPlanName })
    : confirmTarget.kind === "downgrade"
    ? t("changePlan.confirmBodyDowngrade", { plan: confirmPlanName })
    : pageInterval === "annual"
    ? t("changePlan.confirmBodyAnnual", { plan: confirmPlanName })
    : t("changePlan.confirmBodyMonthly", { plan: confirmPlanName });

  const statusBadges = (
    <>
      {status.trialing && (
        <Badge variant="accent">
          {t("trialBadge", { days: trialDaysLeft ?? 0 })}
        </Badge>
      )}
      {status.active && !status.trialing && (
        <Badge variant="positive">{t("activeBadge")}</Badge>
      )}
      {status.cancelAtPeriodEnd && (
        <Badge variant="warning">{t("cancelsAtPeriodEndBadge")}</Badge>
      )}
    </>
  );
  const hasStatusBadge = Boolean(status.trialing || (status.active && !status.trialing) || status.cancelAtPeriodEnd);

  return (
    <div className="space-y-8">
      {/* Current plan */}
      <Section
        title={t("title")}
        description={t("description")}
        action={hasStatusBadge ? statusBadges : undefined}
        bordered
      >
        <SettingsRow
          title={
            <>
              {plan ? t("planName", { plan: plan.name }) : t("noActivePlan")}
              {status.interval && (
                <span className="font-normal text-muted-foreground">
                  {" "}· {status.interval === "annual" ? t("annualBilling") : t("monthlyBilling")}
                </span>
              )}
            </>
          }
          description={plan ? (
            <>
              {t("priceLine", { price: status.interval === "annual" ? plan.price.annual : plan.price.monthly })}
              {status.currentPeriodEnd && (
                <> · {t("renews", { date: new Date(status.currentPeriodEnd).toLocaleDateString(locale) })}</>
              )}
            </>
          ) : undefined}
        >
          {canManageBilling ? (
            billing?.billable ? (
              <Button variant="outline" size="sm" onClick={openPortal} disabled={busy}>
                {busy ? t("opening") : t("manageBilling")}
              </Button>
            ) : billing?.active ? (
              // Comped workspace: no Stripe customer, so the portal has
              // nothing to manage — say so instead of erroring.
              <p className="m-0 text-[13px] text-muted-foreground sm:text-end">
                {t("complimentaryPlan")}
              </p>
            ) : null
          ) : (
            <p className="m-0 text-[13px] text-muted-foreground sm:text-end">
              {t("managedByOwner")}
            </p>
          )}
        </SettingsRow>
      </Section>

      {canManageBilling && status.active && (
        <AddonsCard key={addonsRefreshKey} interval={status.interval} tier={tier} workspaceId={workspaceId} />
      )}

      {/* Plan comparison + direct switching */}
      <Section
        title={t("comparePlansTitle")}
        description={t("comparePlansDescription")}
        action={
          <Tabs value={pageInterval} onValueChange={(value) => setPageInterval(value as BillingInterval)}>
            <TabsList>
              <TabsTrigger value="monthly">{t("changePlan.intervalMonthly")}</TabsTrigger>
              <TabsTrigger value="annual">{t("changePlan.intervalAnnual")}</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PLAN_TIERS.map((tKey) => {
            const p = PLANS[tKey];
            const isCurrent = tKey === tier;
            return (
              <div
                key={tKey}
                className={cn(
                  "flex flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5",
                  isCurrent ? "border-mk-accent" : "border-border",
                )}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="m-0 text-sm font-semibold text-foreground">{p.name}</p>
                    {isCurrent && <Badge variant="accent">{t("changePlan.currentPlanBadge")}</Badge>}
                    {p.badge && !isCurrent && <Badge variant="outline">{p.badge}</Badge>}
                  </div>
                  <p className="m-0 mt-2 text-foreground">
                    <span className="mk-figure text-2xl font-semibold">
                      {t("priceMonthly", { price: pageInterval === "annual" ? p.price.annual : p.price.monthly })}
                    </span>
                    <span className="text-[13px] text-muted-foreground">{t("perMonth")}</span>
                  </p>
                  {pageInterval === "annual" && (
                    <p className="m-0 text-xs text-mk-ink-40">{t("changePlan.billedAnnually")}</p>
                  )}
                  <p className="m-0 mt-1.5 text-[13px] leading-5 text-muted-foreground text-pretty">{p.description}</p>
                </div>
                <div className="flex-1 space-y-1.5 border-t border-border pt-3">
                  {p.features.slice(0, 6).map((f) => (
                    <div key={f} className="flex items-start gap-1.5">
                      <Check className="mt-0.5 size-3 shrink-0 text-mk-pos" />
                      <span className="text-[13px] leading-5 text-mk-ink-80">{f}</span>
                    </div>
                  ))}
                  {p.features.length > 6 && (
                    <p className="m-0 ps-4.5 text-[13px] text-muted-foreground">
                      {t("moreFeatures", { count: p.features.length - 6 })}
                    </p>
                  )}
                </div>
                {canManageBilling && billing && (
                  <div className="pt-1">
                    {billableActive ? (
                      billing.tier === tKey && billing.interval === pageInterval ? (
                        <Button variant="outline" size="sm" className="w-full" disabled>
                          {t("changePlan.currentPlanCta")}
                        </Button>
                      ) : billing.tier === tKey ? (
                        <Button size="sm" className="w-full" onClick={() => openConfirm(tKey, "interval")}>
                          {pageInterval === "annual" ? t("changePlan.switchToAnnual") : t("changePlan.switchToMonthly")}
                        </Button>
                      ) : (PLAN_RANK[tKey] ?? 0) > (PLAN_RANK[billing.tier ?? ""] ?? 0) ? (
                        <Button size="sm" className="w-full" onClick={() => openConfirm(tKey, "upgrade")}>
                          {t("changePlan.upgradeTo", { plan: p.name })}
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" className="w-full" onClick={() => openConfirm(tKey, "downgrade")}>
                          {t("changePlan.downgradeTo", { plan: p.name })}
                        </Button>
                      )
                    ) : (
                      // Free, comped, or lapsed: no in-place switch — go
                      // through Stripe Checkout for a fresh subscription.
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={checkoutTier !== null}
                        onClick={() => startCheckout(tKey, pageInterval)}
                      >
                        {checkoutTier === tKey ? t("changePlan.redirecting") : t("changePlan.choosePlan", { plan: p.name })}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* Plan-change confirmation */}
      <Dialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open && !confirmBusy) closeConfirm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmTitle}</DialogTitle>
            <DialogDescription>{confirmBody}</DialogDescription>
          </DialogHeader>
          {confirmError && (
            <Notice tone="negative">
              <div className="space-y-1">
                {confirmError.map((line) => (
                  <p key={line} className="m-0">{line}</p>
                ))}
              </div>
            </Notice>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeConfirm} disabled={confirmBusy}>
              {t("changePlan.cancel")}
            </Button>
            <Button onClick={applyPlanChange} disabled={confirmBusy}>
              {confirmBusy ? t("changePlan.confirmWorking") : t("changePlan.confirmCta")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
