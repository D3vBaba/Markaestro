"use client";

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import PageHeader from "@/components/app/PageHeader";
import Select from "@/components/app/Select";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import { apiDelete, apiGet, apiPost, apiPut, apiFetch } from "@/lib/api-client";
import { startOAuthAuthorize } from "@/lib/in-app-browser";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
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

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function apiErrorMessage(data: unknown, fallback: string) {
  const err = data as { message?: string; error?: string } | null | undefined;
  return err?.message || err?.error || fallback;
}

function formatMonthKey(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function ApiTrendBars({ points }: { points: ApiClientTrendPoint[] }) {
  const max = Math.max(...points.map((point) => point.requests), 1);

  return (
    <div className="flex h-10 items-end gap-1">
      {points.map((point) => (
        <div key={point.date} className="flex-1">
          <div
            className="w-full rounded-t-sm bg-primary/60 transition-all"
            style={{ height: `${Math.max((point.requests / max) * 100, point.requests > 0 ? 10 : 2)}%` }}
            title={`${point.label}: ${point.requests} requests`}
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
  { id: 'products.read', label: 'Read products' },
  { id: 'media.write', label: 'Upload media' },
  { id: 'posts.read', label: 'Read posts' },
  { id: 'posts.write', label: 'Create posts' },
  { id: 'posts.publish', label: 'Publish posts' },
  { id: 'job_runs.read', label: 'Read publish runs' },
  { id: 'webhooks.manage', label: 'Manage webhooks' },
] as const;

const WEBHOOK_EVENT_OPTIONS = [
  { id: 'post.publish.queued', label: 'Post queued' },
  { id: 'post.published', label: 'Meta publish completed' },
  { id: 'post.action_required', label: 'TikTok action required' },
  { id: 'post.failed', label: 'Post failed' },
] as const;

const TABS = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'usage', label: 'Usage', icon: BarChart3 },
  { id: 'integrations', label: 'Integrations', icon: Link2 },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'workspaces', label: 'Workspaces', icon: Building2 },
  { id: 'api', label: 'API Access', icon: KeyRound },
  { id: 'billing', label: 'Billing', icon: CreditCard },
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
  const searchParams = useSearchParams();
  const rawTab = searchParams?.get('tab');
  const initialTab = (TABS.find((t) => t.id === rawTab)?.id ?? 'account') as Tab;
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  return (
    <AppShell>
      <PageHeader title="Settings" subtitle="Manage your account, team, integrations, and billing." />

      {/* Tab bar */}
      <div
        className="flex gap-6 border-b mb-6 overflow-x-auto no-scrollbar"
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
              className="flex items-center gap-1.5 py-2.5 text-[13px] transition-colors -mb-px whitespace-nowrap"
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
              {tab.label}
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
  const { user, resetPassword, sendVerificationEmail, requestEmailChange, logout } = useAuth();
  const { current: workspace } = useWorkspace();
  const [resettingPassword, setResettingPassword] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [pendingEmailChange, setPendingEmailChange] = useState<string | null>(null);
  const [resendingEmailChange, setResendingEmailChange] = useState(false);

  if (!user) return null;

  const displayName = user.displayName || user.email?.split("@")[0] || "User";
  const email = user.email || "";
  const initials = displayName.slice(0, 2).toUpperCase();

  // Check sign-in method
  const hasPassword = user.providerData?.some((p) => p.providerId === "password");
  const providers = user.providerData?.map((p) => {
    if (p.providerId === "password") return "Email & Password";
    if (p.providerId === "google.com") return "Google";
    if (p.providerId === "facebook.com") return "Facebook";
    return p.providerId;
  }) ?? [];

  async function handleResetPassword() {
    if (!email) return;
    setResettingPassword(true);
    try {
      await resetPassword(email);
      toast.success("Password reset email sent — check your inbox");
    } catch {
      toast.error("Failed to send password reset email");
    } finally {
      setResettingPassword(false);
    }
  }

  async function handleSendVerification() {
    setSendingVerification(true);
    try {
      await sendVerificationEmail();
      toast.success('Verification email sent — check your inbox');
    } catch {
      toast.error('Failed to send verification email');
    } finally {
      setSendingVerification(false);
    }
  }

  async function handleEmailChange() {
    const candidate = newEmail.trim();
    if (!candidate) return;
    setChangingEmail(true);
    try {
      await requestEmailChange(candidate);
      toast.success('Confirm the email change from your inbox');
      setPendingEmailChange(candidate);
      setNewEmail('');
    } catch {
      toast.error('Failed to start email change');
    } finally {
      setChangingEmail(false);
    }
  }

  async function handleResendEmailChange() {
    if (!pendingEmailChange) return;
    setResendingEmailChange(true);
    try {
      await requestEmailChange(pendingEmailChange);
      toast.success('Confirmation email re-sent');
    } catch {
      toast.error('Failed to resend confirmation');
    } finally {
      setResendingEmailChange(false);
    }
  }

  return (
    <div className="grid gap-5">
      {/* Profile */}
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your account information.</CardDescription>
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
                    {p === "Email & Password" ? <KeyRound className="h-3 w-3 mr-1" /> : null}
                    {p === "Google" ? <Mail className="h-3 w-3 mr-1" /> : null}
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

      {/* Security */}
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Security
          </CardTitle>
          <CardDescription>Manage your password and sign-in methods.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!user.emailVerified && (
            <div className="rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Email verification</p>
                <p className="text-xs text-muted-foreground">
                  Verify your email address to secure your account.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={handleSendVerification}
                disabled={sendingVerification}
              >
                {sendingVerification ? 'Sending…' : 'Send verification email'}
              </Button>
            </div>
          )}

          {hasPassword && (
            <div className="rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Password</p>
                <p className="text-xs text-muted-foreground">
                  Send a password reset link to your email address.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={handleResetPassword}
                disabled={resettingPassword}
              >
                {resettingPassword ? "Sending…" : "Reset password"}
              </Button>
            </div>
          )}

          {hasPassword && (
            <div className="rounded-xl border p-4 space-y-3">
              <div>
                <p className="text-sm font-medium">Change email</p>
                <p className="text-xs text-muted-foreground">
                  We’ll email a confirmation link to your new address.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="new-email@company.com"
                  type="email"
                  className="h-10 rounded-xl"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={handleEmailChange}
                  disabled={changingEmail || !newEmail.trim()}
                >
                  {changingEmail ? 'Sending…' : 'Send confirmation'}
                </Button>
              </div>
              {pendingEmailChange && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full px-2.5 py-1 text-xs" style={pillStyle("warn")}>
                    Confirmation sent to {pendingEmailChange}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleResendEmailChange}
                    disabled={resendingEmailChange}
                  >
                    {resendingEmailChange ? 'Resending…' : 'Resend'}
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Sign out</p>
              <p className="text-xs text-muted-foreground">
                Sign out of all devices.
              </p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={logout}>
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/20">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>Irreversible actions that affect your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-destructive/20 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Delete account</p>
              <p className="text-xs text-muted-foreground">
                Permanently delete your account and all associated data. This cannot be undone.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Account deletion is handled by support —{" "}
                <a href="/contact" className="text-primary hover:underline">contact us</a>.
              </p>
            </div>
            <Button variant="destructive" size="sm" className="shrink-0" disabled>
              Delete account
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
}: {
  label: string;
  current: number;
  limit: number;
  unit?: string;
}) {
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
            <span className="text-muted-foreground">Not available</span>
          ) : unlimited ? (
            <>{current.toLocaleString()} used{unit ? ` ${unit}` : ""}</>
          ) : (
            <>{current.toLocaleString()} / {limit.toLocaleString()}{unit ? ` ${unit}` : ""}</>
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

  const month = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="grid gap-5">
      <Card className="border-border/30">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Usage this month
              </CardTitle>
              <CardDescription>{month} · {plan.name} plan</CardDescription>
            </div>
            {status?.trialing && (
              <Badge className="bg-primary/10 text-primary border-0">Trial</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Media uploads */}
          <UsageMeter
            label="Media uploads"
            current={usage?.mediaUploads.current ?? 0}
            limit={usage?.mediaUploads.limit ?? plan.limits.mediaUploads}
          />

          {/* Channels */}
          <UsageMeter
            label="Connected channels"
            current={usage?.channels.current ?? 0}
            limit={usage?.channels.limit ?? plan.limits.channels}
          />

          {/* Products */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-sm font-medium">Products registered</p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {usage?.products.current ?? 0}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Plan limits summary */}
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle>Plan limits</CardTitle>
          <CardDescription>What your {plan.name} plan includes.</CardDescription>
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
              Upgrade plan
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
const PRODUCT_CHANNELS: { provider: string; label: string; sub: string }[] = [
  { provider: "meta", label: "Facebook", sub: "Facebook Page (Facebook login)" },
  { provider: "instagram", label: "Instagram", sub: "Instagram account (Instagram login)" },
  { provider: "tiktok", label: "TikTok", sub: "TikTok account" },
  { provider: "threads", label: "Threads", sub: "Threads account" },
  { provider: "pinterest", label: "Pinterest", sub: "Pinterest account and board" },
];

type ConnEntry = {
  provider: string;
  scope?: "workspace" | "product";
  status?: string;
  pageId?: string | null;
  pageName?: string | null;
  igAccountId?: string | null;
  username?: string | null;
  boardId?: string | null;
  boardName?: string | null;
  boardSelectionRequired?: boolean;
  pageSelectionRequired?: boolean;
  needsPageSelection?: boolean;
};

type MetaPage = { id: string; name: string; hasInstagram: boolean; igAccountId: string | null };

function IntegrationsTab() {
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
  const [pagesError, setPagesError] = useState("");
  const [selectingPage, setSelectingPage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("oauth");
    const provider = params.get("provider");
    const productId = params.get("productId");
    const needsPageSelect = params.get("needsPageSelect");

    if (oauth === "success" && provider) {
      toast.success(`${provider === "meta" ? "Meta" : provider} connected`);
      window.history.replaceState({}, "", "/settings?tab=integrations");
      const timer = setTimeout(() => invalidateQueries("/api/integrations"), 500);
      if (needsPageSelect === "1" && provider === "meta" && productId) {
        setPagePickerProduct(productId);
      }
      return () => clearTimeout(timer);
    }
    if (oauth === "error" && provider) {
      const message = params.get("message");
      toast.error(`Failed to connect ${provider === "meta" ? "Meta" : provider}${message ? `: ${message}` : ""}`);
      window.history.replaceState({}, "", "/settings?tab=integrations");
    }
  }, []);

  // Load the user's Facebook Pages when the picker opens.
  useEffect(() => {
    if (!pagePickerProduct) return;
    let cancelled = false;
    setPages(null);
    setPagesError("");
    (async () => {
      const res = await apiGet<{ pages?: MetaPage[]; error?: string }>(
        `/api/oauth/pages/meta?productId=${encodeURIComponent(pagePickerProduct)}`,
        wsId,
      );
      if (cancelled) return;
      if (!res.ok) {
        setPages([]);
        setPagesError(res.data?.error || "Couldn't load your Facebook Pages.");
        return;
      }
      setPages(res.data.pages || []);
      if (res.data.error) setPagesError(res.data.error);
    })();
    return () => { cancelled = true; };
  }, [pagePickerProduct, wsId]);

  function connect(provider: string, productId: string) {
    const returnTo = encodeURIComponent("/settings?tab=integrations");
    startOAuthAuthorize(`/api/oauth/authorize/${provider}?productId=${encodeURIComponent(productId)}&returnTo=${returnTo}`);
  }

  async function confirmDisconnect() {
    if (!disconnectTarget) return;
    const { productId, provider, label } = disconnectTarget;
    setBusy(`${productId}:${provider}`);
    try {
      const res = await apiPost(`/api/oauth/disconnect/${provider}`, { productId }, wsId);
      if (res.ok) {
        toast.success(`${label} unlinked`);
        refreshConns();
      } else {
        toast.error("Failed to unlink. Please try again.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
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
        toast.success(`Linked ${page.name}`);
        setPagePickerProduct(null);
        refreshConns();
      } else {
        toast.error("Failed to link this Page. Please try again.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSelectingPage(null);
    }
  }

  function channelStatus(productId: string, provider: string): ChannelStatus {
    const entry = (connsByProduct[productId] || []).find((c) => c.provider === provider);
    return resolveChannelStatus(provider, entry);
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
          <CardTitle>No products yet</CardTitle>
          <CardDescription>Create a product, then link its social channels here.</CardDescription>
        </CardHeader>
        <CardContent>
          <a href="/products"><Button>Create a product</Button></a>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">
        Link each product to its own social channels. Each channel publishes only to itself — Meta covers a Facebook
        Page and its linked Instagram account.
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
              return (
                <div key={ch.provider} className="flex items-center justify-between gap-3 rounded-xl border p-3.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{ch.label}</p>
                      {st.state === "connected" && <Badge className="border-0" style={pillStyle("pos")}>Linked</Badge>}
                      {st.state === "needs-page" && (
                        <Badge className="border-0" style={pillStyle("warn")}>
                          {ch.provider === "pinterest" ? "Pick a board" : "Pick a Page"}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {st.state === "connected" ? (st.label || "Linked and ready.") : ch.sub}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {st.state === "connected" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => setDisconnectTarget({ productId: product.id, provider: ch.provider, label: `${ch.label} · ${product.name}` })}
                      >
                        {isBusy ? "Unlinking…" : "Unlink"}
                      </Button>
                    ) : st.state === "needs-page" ? (
                      ch.provider === "pinterest" ? (
                        <a href="/products"><Button size="sm">Choose board</Button></a>
                      ) : (
                        <Button size="sm" onClick={() => setPagePickerProduct(product.id)}>Choose Page</Button>
                      )
                    ) : (
                      <Button size="sm" onClick={() => connect(ch.provider, product.id)}>Link</Button>
                    )}
                  </div>
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
            <DialogTitle>Choose a Facebook Page</DialogTitle>
            <DialogDescription>
              Pick the Page this product posts to. Its linked Instagram account is included automatically.
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
              <p className="text-sm text-muted-foreground">No Facebook Pages were found on your Meta account.</p>
            ) : (
              pages.map((pg) => (
                <button
                  key={pg.id}
                  type="button"
                  disabled={!!selectingPage}
                  onClick={() => selectPage(pg)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition-colors hover:border-primary/50 disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{pg.name}</p>
                    <p className="text-xs text-muted-foreground">{pg.hasInstagram ? "Facebook + Instagram" : "Facebook only"}</p>
                  </div>
                  <span className="text-xs text-primary shrink-0">{selectingPage === pg.id ? "Linking…" : "Select"}</span>
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
        confirmLabel="Unlink"
        warning="This unlinks the channel from this product only. Other products keep their own connections. You can re-link any time."
        onConfirm={confirmDisconnect}
      />
    </div>
  );
}

/* ─── Team Tab ──────────────────────────────────────────────────────────── */

function TeamTab() {
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
      setInviteEmailError('Enter a valid email address, e.g. colleague@example.com');
      return;
    }
    setInviteEmailError(null);
    setInviting(true);
    try {
      const res = await apiPost<{ status: string; email: string }>('/api/team', { email: candidate, role: inviteRole }, wsId);
      if (res.ok) {
        const s = res.data.status;
        if (s === 'pending') toast.success(`Invite sent to ${res.data.email} — they'll join when they sign up`);
        else if (s === 'already_owner') toast.info(`${inviteEmail} is already an owner`);
        else toast.success(`${inviteEmail} added as ${inviteRole}`);
        setInviteEmail('');
        fetchMembers();
      } else {
        const err = (res.data as { error?: string }).error;
        if (err === 'TEAM_LIMIT_REACHED') toast.error(`Your ${plan.name} plan supports up to ${limit} team members. Upgrade to add more.`);
        else toast.error('Failed to invite. Please try again.');
      }
    } catch {
      toast.error('Something went wrong.');
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
        toast.success('Member removed');
        fetchMembers();
      } else {
        toast.error('Failed to remove member');
      }
    } catch {
      toast.error('Something went wrong');
    } finally {
      setRemoving(null);
    }
  }

  const roleDescriptions: Record<string, string> = {
    owner: "Full access to everything",
    admin: "Manage team, integrations, and content",
    member: "Create and publish content",
    analyst: "View-only dashboard access",
  };

  return (
    <div className="grid gap-5">
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle>Team members</CardTitle>
          <CardDescription>
            {limit === -1
              ? `Unlimited members on the ${plan.name} plan`
              : `${membersLoading ? "…" : members.length} / ${limit} members on the ${plan.name} plan`}
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
              <p className="text-sm text-muted-foreground px-4 py-3">No members yet.</p>
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
                    <p className="text-xs text-muted-foreground capitalize">
                      {m.role}
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
                    {removing === m.uid ? 'Removing…' : 'Remove'}
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Invite form */}
          {canInvite && (limit === -1 || members.length < limit) && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Invite a new member</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  type="email"
                  placeholder="colleague@example.com"
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
                    <option value="member">Member</option>
                    <option value="analyst">Analyst</option>
                    <option value="admin">Admin</option>
                  </Select>
                </div>
                <Button onClick={invite} disabled={inviting || !inviteEmail.trim()}>
                  {inviting ? 'Inviting…' : 'Invite'}
                </Button>
              </div>
              {inviteEmailError && (
                <p className="text-xs text-mk-neg">{inviteEmailError}</p>
              )}
            </div>
          )}

          {canInvite && limit !== -1 && members.length >= limit && (
            <p className="text-xs text-muted-foreground pt-1">
              Team member limit reached.{' '}
              <a href="/settings?tab=billing" className="text-primary hover:underline">Upgrade your plan</a> to invite more.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Roles reference */}
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle>Roles & permissions</CardTitle>
          <CardDescription>What each role can do in this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-3">
            {(["owner", "admin", "member", "analyst"] as const).map((role) => (
              <div key={role} className="rounded-lg border p-3">
                <p className="text-sm font-medium capitalize">{role}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{roleDescriptions[role]}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <ConfirmDeleteDialog
        open={!!removeTarget}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
        entity="team member"
        name={removeTarget?.email}
        confirmLabel="Remove"
        warning="This person will immediately lose access to this workspace."
        onConfirm={confirmRemoveMember}
      />
    </div>
  );
}

/* ─── Workspaces Tab ────────────────────────────────────────────────────── */

function WorkspacesTab() {
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
        toast.success(`Workspace "${newName.trim()}" created`);
        setNewName('');
        await refresh();
        switchWorkspace(res.data.id);
      } else {
        const err = (res.data as { error?: string }).error;
        if (err === 'WORKSPACE_LIMIT_REACHED') {
          toast.error(`Your ${plan.name} plan supports up to ${limit} workspace${limit === 1 ? '' : 's'}. Upgrade to create more.`);
        } else {
          toast.error('Failed to create workspace');
        }
      }
    } catch {
      toast.error('Something went wrong');
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
        toast.success('Workspace renamed');
        setEditingId(null);
        await refresh();
      } else {
        toast.error('Failed to rename workspace');
      }
    } catch {
      toast.error('Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle>Workspaces</CardTitle>
          <CardDescription>
            {limit === -1
              ? `Unlimited workspaces on the ${plan.name} plan`
              : `${ownedCount} / ${limit} workspace${limit === 1 ? '' : 's'} owned on the ${plan.name} plan`}
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
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => { setEditingId(ws.id); setEditName(ws.name); }}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground capitalize">{ws.role}</p>
                    </>
                  )}
                </div>
                {ws.id === current?.id ? (
                  <Badge className="bg-primary/10 text-primary border-0 shrink-0">Active</Badge>
                ) : (
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => switchWorkspace(ws.id)}>
                    Switch
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Create workspace */}
          {canCreate && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Create a new workspace</p>
              <div className="flex gap-2">
                <Input
                  placeholder="New workspace name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createWorkspace()}
                  className="flex-1"
                />
                <Button onClick={createWorkspace} disabled={creating || !newName.trim()}>
                  {creating ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </div>
          )}

          {!canCreate && (
            <p className="text-xs text-muted-foreground pt-1">
              Workspace limit reached.{' '}
              <a href="/settings?tab=billing" className="text-primary hover:underline">Upgrade your plan</a> to create more.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── API Access Tab ───────────────────────────────────────────────────── */

function ApiAccessTab() {
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

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}`);
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
        toast.error(apiErrorMessage(res.data, 'Failed to create API key'));
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
      toast.error('Failed to create API key');
    } finally {
      setCreatingClient(false);
    }
  }

  async function revokeClient(id: string) {
    setRevokingClient(id);
    try {
      const res = await apiDelete(`/api/settings/api-clients/${id}`, undefined, wsId);
      if (res.ok) {
        toast.success('API key revoked');
        await fetchApiAccess();
      } else {
        toast.error('Failed to revoke API key');
      }
    } catch {
      toast.error('Failed to revoke API key');
    } finally {
      setRevokingClient(null);
    }
  }

  async function archiveClient(id: string, archived: boolean) {
    setArchivingClient(id);
    try {
      const res = await apiPost(`/api/settings/api-clients/${id}/archive`, { archived }, wsId);
      if (res.ok) {
        toast.success(archived ? 'API key archived' : 'API key unarchived');
        await fetchApiAccess();
      } else {
        toast.error(apiErrorMessage(res.data, archived ? 'Failed to archive API key' : 'Failed to unarchive API key'));
      }
    } catch {
      toast.error(archived ? 'Failed to archive API key' : 'Failed to unarchive API key');
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
        toast.error(apiErrorMessage(res.data, 'Failed to rotate API key'));
        return;
      }

      setRotateTarget(null);
      setCreatedKeyMode('rotated');
      setCreatedApiKey(res.data.apiKey);
      toast.success('API key rotated');
      await fetchApiAccess();
    } catch {
      toast.error('Failed to rotate API key');
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
        toast.success('API key permissions updated');
        setEditKeyOpen(false);
        setEditingClient(null);
        setEditingScopes([]);
        await fetchApiAccess();
      } else {
        toast.error('Failed to update API key permissions');
      }
    } catch {
      toast.error('Failed to update API key permissions');
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
        toast.error('Failed to create webhook endpoint');
        return;
      }

      setCreatedWebhookSecret(res.data.webhookEndpoint.secret);
      setWebhookUrl('');
      setSelectedEvents(['post.published', 'post.action_required', 'post.failed']);
      setCreateWebhookOpen(false);
      await fetchApiAccess();
    } catch {
      toast.error('Failed to create webhook endpoint');
    } finally {
      setCreatingWebhook(false);
    }
  }

  async function disableWebhook(id: string) {
    setDisablingWebhook(id);
    try {
      const res = await apiDelete(`/api/settings/webhook-endpoints/${id}`, undefined, wsId);
      if (res.ok) {
        toast.success('Webhook endpoint disabled');
        await fetchApiAccess();
      } else {
        toast.error('Failed to disable webhook endpoint');
      }
    } catch {
      toast.error('Failed to disable webhook endpoint');
    } finally {
      setDisablingWebhook(null);
    }
  }

  if (!canManage) {
    return (
      <div className="grid gap-5">
        <Card className="border-border/30">
          <CardHeader>
            <CardTitle>API Access</CardTitle>
            <CardDescription>Only workspace owners and admins can manage API keys and webhook endpoints.</CardDescription>
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
                Public API
              </CardTitle>
              <CardDescription>
                Manage workspace API keys, webhook destinations, and publishing behavior for Meta and TikTok.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="/developers/api" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <BookOpen className="mr-1.5 h-3.5 w-3.5" />
                  View docs
                </Button>
              </a>
              <Button size="sm" onClick={() => setCreateKeyOpen(true)}>
                Create API key
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-xl border p-4">
              <p className="text-sm font-medium">Video support</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Public API v1 supports Facebook, Instagram, and TikTok media uploads. TikTok videos follow the same direct inbox handoff as the app before the creator finishes them in TikTok.
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-sm font-medium">Channel media caps</p>
              <p className="mt-1 text-xs text-muted-foreground">
                TikTok supports either 1 video or up to 10 images per post. Other channels keep their own platform-specific media limits.
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-sm font-medium">TikTok inbox handoffs</p>
              <p className="mt-1 text-xs text-muted-foreground">
                TikTok content is pushed to the creator&apos;s TikTok inbox. Markaestro keeps polling TikTok until the platform confirms the inbox item is ready for creator completion.
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Requests this month</p>
              {loading ? <Skeleton className="mt-2 h-8 w-16" /> : (
                <p className="mt-2 text-2xl font-semibold tabular-nums">{usageTotals.currentMonthRequests.toLocaleString()}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{formatMonthKey(apiClientUsage[0]?.usage.currentMonth || new Date().toISOString().slice(0, 7))}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Queued publishes</p>
              {loading ? <Skeleton className="mt-2 h-8 w-16" /> : (
                <p className="mt-2 text-2xl font-semibold tabular-nums">{usageTotals.publishQueued.toLocaleString()}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">All keys in this workspace</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Completed outcomes</p>
              {loading ? <Skeleton className="mt-2 h-8 w-16" /> : (
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {(usageTotals.publishSucceeded + usageTotals.publishActionRequired).toLocaleString()}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {loading
                  ? "Direct publish · TikTok action required"
                  : `${usageTotals.publishSucceeded.toLocaleString()} direct publish · ${usageTotals.publishActionRequired.toLocaleString()} TikTok action required`}
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Failures</p>
              {loading ? <Skeleton className="mt-2 h-8 w-16" /> : (
                <p className="mt-2 text-2xl font-semibold tabular-nums">{usageTotals.publishFailed.toLocaleString()}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">Tracked at publish-run completion</p>
            </div>
          </div>

          {loading ? (
            <div className="py-10 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="rounded-xl border">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">API keys</p>
                    <p className="text-xs text-muted-foreground">Create a key per integration, scope it down to the minimum needed access, and watch live request and publish behavior per key.</p>
                  </div>
                  {archivedClientCount > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => setShowArchived((prev) => !prev)}>
                      <Archive className="mr-1.5 h-3.5 w-3.5" />
                      {showArchived ? 'Hide archived' : `Show archived (${archivedClientCount})`}
                    </Button>
                  )}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Usage</TableHead>
                      <TableHead>Publish outcomes</TableHead>
                      <TableHead>Scopes</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last used</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleClients.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                          {apiClientUsage.length === 0 ? 'No API keys yet.' : 'No active API keys.'}
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
                                  Product: {productNameById(client.productId)}
                                </Badge>
                              )}
                              <ApiTrendBars points={client.trend} />
                              <p className="text-[11px] text-muted-foreground">Last 14 days request trend</p>
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[180px]">
                            <div className="space-y-1 text-xs text-muted-foreground">
                              <p><span className="font-medium text-foreground tabular-nums">{(client.usage.currentMonthCounts.request || 0).toLocaleString()}</span> requests this month</p>
                              <p><span className="font-medium text-foreground tabular-nums">{client.usage.totalRequests.toLocaleString()}</span> total requests</p>
                              <p><span className="font-medium text-foreground tabular-nums">{(client.usage.currentMonthCounts.media_upload || 0).toLocaleString()}</span> uploads · <span className="font-medium text-foreground tabular-nums">{(client.usage.currentMonthCounts.post_create || 0).toLocaleString()}</span> posts created</p>
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[200px]">
                            <div className="space-y-1 text-xs text-muted-foreground">
                              <p><span className="font-medium text-foreground tabular-nums">{(client.usage.currentMonthCounts.publish_queued || 0).toLocaleString()}</span> queued</p>
                              <p><span className="font-medium text-mk-pos tabular-nums">{(client.usage.currentMonthCounts.publish_succeeded || 0).toLocaleString()}</span> direct publish</p>
                              <p><span className="font-medium text-primary tabular-nums">{((client.usage.currentMonthCounts.publish_action_required || 0) + (client.usage.currentMonthCounts.publish_exported_for_review || 0)).toLocaleString()}</span> TikTok action required</p>
                              <p><span className="font-medium text-mk-neg tabular-nums">{(client.usage.currentMonthCounts.publish_failed || 0).toLocaleString()}</span> failed</p>
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
                                {client.status}
                              </Badge>
                              {client.archived && (
                                <Badge className="border-0" style={pillStyle("neutral")}>Archived</Badge>
                              )}
                              {client.expiresAt ? (
                                new Date(client.expiresAt).getTime() <= Date.now() ? (
                                  <Badge className="border-0" style={pillStyle("neg")}>Expired</Badge>
                                ) : (
                                  <p className="text-[11px] text-muted-foreground">Expires {formatShortDate(client.expiresAt)}</p>
                                )
                              ) : (
                                <p className="text-[11px] text-muted-foreground">Never expires</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleString() : 'Never'}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1.5">
                              {client.archived ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => archiveClient(client.id, false)}
                                  disabled={archivingClient === client.id}
                                >
                                  <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" />
                                  {archivingClient === client.id ? 'Restoring…' : 'Unarchive'}
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openEditClient(client)}
                                    disabled={client.status !== 'active'}
                                  >
                                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                    Edit permissions
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setRotateTarget(client)}
                                    disabled={client.status !== 'active' || rotatingClient}
                                  >
                                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                    Rotate
                                  </Button>
                                  {client.status === 'revoked' ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => archiveClient(client.id, true)}
                                      disabled={archivingClient === client.id}
                                    >
                                      <Archive className="mr-1.5 h-3.5 w-3.5" />
                                      {archivingClient === client.id ? 'Archiving…' : 'Archive'}
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-mk-neg hover:text-mk-neg"
                                      onClick={() => revokeClient(client.id)}
                                      disabled={revokingClient === client.id}
                                    >
                                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                      {revokingClient === client.id ? 'Revoking…' : 'Revoke'}
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
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Webhook endpoints</p>
                    <p className="text-xs text-muted-foreground">Receive delivery events when publishes queue, complete, need user action in TikTok, or fail. These are signed and retried from the worker.</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setCreateWebhookOpen(true)}>
                    <Webhook className="mr-1.5 h-3.5 w-3.5" />
                    Add webhook
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Events</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {webhookEndpoints.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                          No webhook endpoints yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      webhookEndpoints.map((endpoint) => (
                        <TableRow key={endpoint.id}>
                          <TableCell className="max-w-[320px] whitespace-normal">
                            <div className="flex items-start gap-2">
                              <div className="min-w-0">
                                <p className="font-medium break-all">{endpoint.url}</p>
                                <p className="text-xs text-muted-foreground">Created {new Date(endpoint.createdAt).toLocaleString()}</p>
                              </div>
                              <button
                                className="text-muted-foreground hover:text-foreground transition-colors"
                                onClick={() => copyText(endpoint.url, 'Webhook URL')}
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
                              {endpoint.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-mk-neg hover:text-mk-neg"
                              onClick={() => disableWebhook(endpoint.id)}
                              disabled={endpoint.status !== 'active' || disablingWebhook === endpoint.id}
                            >
                              {disablingWebhook === endpoint.id ? 'Disabling…' : 'Disable'}
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
          <CardTitle>Operational notes</CardTitle>
          <CardDescription>Behavior that external integrators should expect from the v1 publishing API.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border p-4">
            <p className="text-sm font-medium">Rate limiting</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Markaestro enforces API-key rate limits plus destination-level throttling so one integration cannot overload a workspace or platform account.
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm font-medium">Webhook secrets are one-time visible</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Store the returned webhook secret immediately. It is hashed at rest and not shown again.
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm font-medium">Async publish runs</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Every publish returns a queued run. Poll the run endpoint or subscribe to webhooks instead of assuming immediate delivery.
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm font-medium">TikTok inbox items need user completion</p>
            <p className="mt-1 text-xs text-muted-foreground">
              TikTok posts are pushed into the creator&apos;s TikTok inbox first. Once TikTok finishes processing, the creator opens TikTok to finish caption, privacy, and posting. Scheduling triggers that inbox handoff; it does not publish publicly on the creator&apos;s behalf.
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={createKeyOpen} onOpenChange={setCreateKeyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Create a scoped key for a single integration. Keep scopes narrow and rotate per workflow.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-client-name">Key name</Label>
              <Input id="api-client-name" placeholder="Zapier production" value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-client-expiry">Expires</Label>
              <Select
                id="api-client-expiry"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value as 'never' | '30' | '90' | '365')}
              >
                <option value="never">Never</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-client-product">Product</Label>
              <Select
                id="api-client-product"
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                disabled={products.length === 0}
              >
                <option value="" disabled>Select a product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                {products.length === 0
                  ? 'Create a product first — every API key is scoped to one product.'
                  : 'Required. The key only targets this product; requests for any other product are rejected.'}
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Scopes</Label>
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
                  {selectedScopes.length === API_SCOPE_OPTIONS.length ? 'Clear' : 'Select all'}
                </button>
              </div>
              <div className="grid gap-2 rounded-xl border p-3">
                {API_SCOPE_OPTIONS.map((scope) => (
                  <Label key={scope.id} className="justify-start">
                    <Checkbox
                      checked={selectedScopes.includes(scope.id)}
                      onCheckedChange={(checked) => setSelectedScopes((current) => toggleSelection(current, scope.id, checked === true))}
                    />
                    <span>{scope.label}</span>
                    <span className="text-xs text-muted-foreground">{scope.id}</span>
                  </Label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateKeyOpen(false)}>Cancel</Button>
            <Button onClick={createClient} disabled={creatingClient || !clientName.trim() || selectedScopes.length === 0 || !selectedProductId}>
              {creatingClient ? 'Creating…' : 'Create key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createWebhookOpen} onOpenChange={setCreateWebhookOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add webhook endpoint</DialogTitle>
            <DialogDescription>
              Markaestro signs every delivery. Use a dedicated endpoint and verify the signature before processing events.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">Destination URL</Label>
              <Input id="webhook-url" placeholder="https://example.com/markaestro/webhook" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
            </div>
            <div className="space-y-3">
              <Label>Events</Label>
              <div className="grid gap-2 rounded-xl border p-3">
                {WEBHOOK_EVENT_OPTIONS.map((eventName) => (
                  <Label key={eventName.id} className="justify-start">
                    <Checkbox
                      checked={selectedEvents.includes(eventName.id)}
                      onCheckedChange={(checked) => setSelectedEvents((current) => toggleSelection(current, eventName.id, checked === true))}
                    />
                    <span>{eventName.label}</span>
                    <span className="text-xs text-muted-foreground">{eventName.id}</span>
                  </Label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateWebhookOpen(false)}>Cancel</Button>
            <Button onClick={createWebhook} disabled={creatingWebhook || !webhookUrl.trim() || selectedEvents.length === 0}>
              {creatingWebhook ? 'Creating…' : 'Add webhook'}
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
            <DialogTitle>Edit API key permissions</DialogTitle>
            <DialogDescription>
              Update the scopes for this key. Changes take effect immediately for future requests.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border p-3">
              <p className="text-sm font-medium">{editingClient?.name || 'API key'}</p>
              <p className="mt-1 text-xs text-muted-foreground">{editingClient?.keyPrefix}…</p>
            </div>
            <div className="space-y-3">
              <Label>Scopes</Label>
              <div className="grid gap-2 rounded-xl border p-3">
                {API_SCOPE_OPTIONS.map((scope) => (
                  <Label key={scope.id} className="justify-start">
                    <Checkbox
                      checked={editingScopes.includes(scope.id)}
                      onCheckedChange={(checked) => setEditingScopes((current) => toggleSelection(current, scope.id, checked === true))}
                    />
                    <span>{scope.label}</span>
                    <span className="text-xs text-muted-foreground">{scope.id}</span>
                  </Label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditKeyOpen(false)}>Cancel</Button>
            <Button onClick={saveClientScopes} disabled={savingClientScopes || editingScopes.length === 0}>
              {savingClientScopes ? 'Saving…' : 'Save permissions'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rotateTarget} onOpenChange={(open) => { if (!open && !rotatingClient) setRotateTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rotate API key</DialogTitle>
            <DialogDescription>
              Generates a new secret for this key. The old secret stops working immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border p-3">
            <p className="text-sm font-medium">{rotateTarget?.name || 'API key'}</p>
            <p className="mt-1 text-xs text-muted-foreground">{rotateTarget?.keyPrefix}…</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotateTarget(null)} disabled={rotatingClient}>Cancel</Button>
            <Button onClick={rotateClient} disabled={rotatingClient}>
              {rotatingClient && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {rotatingClient ? 'Rotating…' : 'Rotate key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdApiKey} onOpenChange={(open) => { if (!open) setCreatedApiKey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createdKeyMode === 'rotated' ? 'API key rotated' : 'API key created'}</DialogTitle>
            <DialogDescription>
              This secret is shown once. Copy it now and store it securely.
            </DialogDescription>
          </DialogHeader>
              <div className="rounded-xl border bg-muted/30 p-3">
            <code className="break-all text-xs">{createdApiKey}</code>
          </div>
          <a href="/developers/api" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
            Review the integration guide before distributing this key
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatedApiKey(null)}>Close</Button>
            <Button onClick={() => createdApiKey && copyText(createdApiKey, 'API key')}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Copy key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdWebhookSecret} onOpenChange={(open) => { if (!open) setCreatedWebhookSecret(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Webhook secret created</DialogTitle>
            <DialogDescription>
              This webhook signing secret is only shown once. Save it before you close this dialog. If you lose this secret, delete and recreate the endpoint.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border bg-muted/30 p-3">
            <code className="break-all text-xs">{createdWebhookSecret}</code>
          </div>
          <p className="text-xs text-muted-foreground">
            Markaestro sends `X-Markaestro-Event`, `X-Markaestro-Timestamp`, and `X-Markaestro-Signature` headers on every delivery.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatedWebhookSecret(null)}>Close</Button>
            <Button onClick={() => createdWebhookSecret && copyText(createdWebhookSecret, 'Webhook secret')}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Copy secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Billing Tab ──────────────────────────────────────────────────────── */

function BillingTab() {
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
        toast.success("Opening billing portal…");
      } else {
        toast.error("Failed to open billing portal");
      }
    } catch {
      toast.error("Something went wrong");
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
              <CardTitle>Billing & Subscription</CardTitle>
              <CardDescription>Manage your plan, payment method, and invoices.</CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {status.trialing && (
                <Badge className="bg-primary/10 text-primary border-0">
                  Trial · {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} left
                </Badge>
              )}
              {status.active && !status.trialing && (
                <Badge className="border-0" style={pillStyle("pos")}>Active</Badge>
              )}
              {status.cancelAtPeriodEnd && (
                <Badge className="border-0" style={pillStyle("warn")}>Cancels at period end</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {plan ? `${plan.name} Plan` : "No active plan"}
                  {status.interval && (
                    <span className="text-muted-foreground font-normal">
                      {" "}· {status.interval === "annual" ? "Annual" : "Monthly"} billing
                    </span>
                  )}
                </p>
                {plan && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    ${status.interval === "annual" ? plan.price.annual : plan.price.monthly}/mo
                    {status.currentPeriodEnd && (
                      <> · Renews {new Date(status.currentPeriodEnd).toLocaleDateString()}</>
                    )}
                  </p>
                )}
              </div>
              {canManageBilling ? (
                <Button variant="outline" size="sm" className="shrink-0" onClick={openPortal} disabled={busy}>
                  {busy ? "Opening..." : "Manage Billing"}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground sm:text-right">
                  Billing is managed by the workspace owner.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Plan comparison */}
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle>Compare plans</CardTitle>
          <CardDescription>See what each plan includes.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {(["starter", "pro", "business"] as const).map((t) => {
              const p = PLANS[t];
              const isCurrent = t === tier;
              return (
                <div
                  key={t}
                  className={cn(
                    "rounded-xl border p-4 space-y-3 transition-colors",
                    isCurrent && "border-primary/30 bg-primary/5",
                  )}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{p.name}</p>
                      {isCurrent && <Badge className="bg-primary/10 text-primary border-0 text-[10px]">Current</Badge>}
                      {p.badge && !isCurrent && <Badge variant="outline" className="text-[10px]">{p.badge}</Badge>}
                    </div>
                    <p className="text-lg font-bold mt-1">
                      ${p.price.monthly}<span className="text-xs font-normal text-muted-foreground">/mo</span>
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
                      <p className="text-xs text-muted-foreground pl-4.5">
                        +{p.features.length - 6} more
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
