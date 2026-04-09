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
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import { apiDelete, apiGet, apiPost, apiPut, apiFetch } from "@/lib/api-client";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { PLANS } from "@/lib/stripe/plans";
import type { PlanTier } from "@/lib/stripe/plans";
import { cn } from "@/lib/utils";
import {
  User, Shield, Zap, Link2, Users, Building2, CreditCard,
  Pencil, Check, X, Loader2, KeyRound, Mail, BarChart3,
  Copy, Webhook, BookOpen, ExternalLink, Trash2,
} from "lucide-react";

type IntegrationInfo = {
  provider: string;
  enabled: boolean;
  status: string;
  hasApiKey: boolean;
  hasAccessToken: boolean;
  fromEmail?: string;
  tokenExpiresAt?: string | null;
  lastRefreshError?: string | null;
  pageId?: string | null;
  pageName?: string | null;
};

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
  keyPrefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
};

type ApiClientTrendPoint = {
  date: string;
  label: string;
  requests: number;
  queued: number;
  succeeded: number;
  exportedForReview: number;
  failed: number;
};

type ApiClientAnalytics = ApiClientInfo & {
  usage: {
    totalRequests: number;
    currentMonth: string;
    currentMonthCounts: Record<string, number>;
  };
  trend: ApiClientTrendPoint[];
};

type ApiAnalyticsTotals = {
  totalRequests: number;
  currentMonthRequests: number;
  publishQueued: number;
  publishSucceeded: number;
  publishExportedForReview: number;
  publishFailed: number;
};

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
  { id: 'post.exported_for_review', label: 'TikTok draft exported' },
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
      <div className="flex gap-0.5 border-b mb-6 overflow-x-auto no-scrollbar">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              data-tab={tab.id}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap",
                activeTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'account' && <AccountTab />}
      {activeTab === 'usage' && <UsageTab />}
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
  const { user, resetPassword, logout } = useAuth();
  const { current: workspace } = useWorkspace();
  const [resettingPassword, setResettingPassword] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);

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
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0"
              onClick={() => setShowDeleteAccount(true)}
            >
              Delete account
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDeleteDialog
        open={showDeleteAccount}
        onOpenChange={setShowDeleteAccount}
        entity="account"
        name={email}
        requireTypedConfirmation
        warning="This will permanently delete your account, all workspaces you own, and all associated data. Team members will lose access to shared workspaces."
        onConfirm={async () => {
          toast.error("Account deletion is not yet available. Please contact support.");
        }}
      />
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
        <p className={cn(
          "text-sm tabular-nums",
          isFull ? "text-destructive font-medium" : isHigh ? "text-amber-600" : "text-muted-foreground",
        )}>
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
            className={cn(
              "h-full rounded-full transition-all duration-500",
              isFull ? "bg-destructive" : isHigh ? "bg-amber-500" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {unlimited && (
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-emerald-500 w-[15%]" />
        </div>
      )}
    </div>
  );
}

function UsageTab() {
  const { status } = useSubscription();
  const [usage, setUsage] = useState<{
    aiGenerations: UsageMetric;
    channels: UsageMetric;
    products: { current: number };
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet<{
          usage: {
            aiGenerations: UsageMetric;
            channels: UsageMetric;
            products: { current: number };
          };
          tier: string;
          plan: string;
        }>("/api/usage");
        if (res.ok) setUsage(res.data.usage);
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, []);

  const tier = (status?.tier ?? 'starter') as PlanTier;
  const plan = PLANS[tier];

  if (loading) {
    return (
      <div className="grid gap-5">
        <Card className="border-border/30">
          <CardContent className="py-12 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
          {/* AI Generations */}
          <UsageMeter
            label="AI generations"
            current={usage?.aiGenerations.current ?? 0}
            limit={usage?.aiGenerations.limit ?? plan.limits.aiGenerations}
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
                <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <span className="text-muted-foreground">{f}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const tabBtn = document.querySelector('[data-tab="billing"]') as HTMLButtonElement | null;
                tabBtn?.click();
              }}
            >
              Upgrade plan
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Integrations Tab ──────────────────────────────────────────────────── */

function IntegrationsTab() {
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<{ provider: string; label: string } | null>(null);

  const fetchIntegrations = useCallback(async () => {
    const res = await apiGet<{ integrations: IntegrationInfo[] }>("/api/integrations");
    if (res.ok) setIntegrations(res.data.integrations || []);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("oauth");
    const provider = params.get("provider");
    const message = params.get("message");

    if (oauthResult === "success" && provider) {
      toast.success(`${provider === "meta" ? "Meta" : provider} connected successfully`);
      window.history.replaceState({}, "", "/settings");
      setTimeout(fetchIntegrations, 500);
    } else if (oauthResult === "error" && provider) {
      toast.error(`Failed to connect ${provider === "meta" ? "Meta" : provider}${message ? `: ${message}` : ""}`);
      window.history.replaceState({}, "", "/settings");
      fetchIntegrations();
    } else {
      fetchIntegrations();
    }
  }, [fetchIntegrations]);

  const isConnected = (provider: string) =>
    integrations.find((i) => i.provider === provider)?.status === "connected";

  const needsReconnect = (provider: string) =>
    integrations.find((i) => i.provider === provider)?.lastRefreshError != null;

  async function startOAuth(provider: string) {
    try {
      const res = await apiPost<{ authUrl: string }>(`/api/oauth/authorize/${provider}`, {});
      if (res.ok && res.data.authUrl) {
        window.location.href = res.data.authUrl;
      } else {
        toast.error((res.data as { error?: string }).error || `Failed to connect`);
      }
    } catch {
      toast.error(`Something went wrong. Please try again.`);
    }
  }

  async function confirmDisconnect() {
    if (!disconnectTarget) return;
    const { provider } = disconnectTarget;
    setDisconnecting(provider);
    try {
      const res = await apiPost(`/api/oauth/disconnect/${provider}`, {});
      if (res.ok) {
        toast.success(`${disconnectTarget.label} disconnected`);
        fetchIntegrations();
      } else {
        toast.error(`Failed to disconnect. Please try again.`);
      }
    } catch {
      toast.error(`Something went wrong. Please try again.`);
    } finally {
      setDisconnecting(null);
    }
  }

  return (
    <div className="grid gap-5">
      <IntegrationCard
        title="Meta (Facebook + Instagram)"
        description="Publish posts and run ad campaigns on Facebook and Instagram."
        connected={isConnected("meta")}
        needsReconnect={needsReconnect("meta")}
        reconnectNote="Your Meta connection needs to be refreshed"
        onConnect={() => startOAuth("meta")}
        onDisconnect={() => setDisconnectTarget({ provider: "meta", label: "Meta (Facebook + Instagram)" })}
        disconnecting={disconnecting === "meta"}
        connectLabel="Connect Meta account"
        extraNote={isConnected("meta") ? (
          <p className="text-xs text-muted-foreground">
            Choose which Facebook page each product posts to in{" "}
            <a href="/products" className="text-primary hover:underline">Products → Edit</a>.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            One connection covers all your products. You can assign a different Facebook page per product afterwards.
          </p>
        )}
      />

      <p className="text-xs text-muted-foreground">
        TikTok and TikTok Ads integrations are set up per product on the{" "}
        <a href="/products" className="text-primary hover:underline">Products page</a>.
      </p>

      <ConfirmDeleteDialog
        open={!!disconnectTarget}
        onOpenChange={(open) => { if (!open) setDisconnectTarget(null); }}
        entity="integration"
        name={disconnectTarget?.label}
        confirmLabel="Disconnect"
        warning="This will revoke access and disconnect all products using this integration. You can reconnect at any time."
        onConfirm={confirmDisconnect}
      />
    </div>
  );
}

function IntegrationCard({
  title, description, connected, needsReconnect, reconnectNote,
  onConnect, onDisconnect, disconnecting, connectLabel, extraNote,
}: {
  title: string; description: string; connected: boolean; needsReconnect: boolean;
  reconnectNote: string; onConnect: () => void; onDisconnect: () => void;
  disconnecting: boolean; connectLabel: string; extraNote?: React.ReactNode;
}) {
  return (
    <Card className="border-border/30">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {needsReconnect && <Badge className="bg-amber-50 text-amber-700 border-0">Action needed</Badge>}
            {connected && !needsReconnect && <Badge className="bg-emerald-50 text-emerald-700 border-0">Connected</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {connected ? (
          <div className="rounded-xl border p-4 space-y-3">
            {needsReconnect ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-amber-700">{reconnectNote}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" onClick={onConnect}>Reconnect</Button>
                  <Button variant="outline" size="sm" onClick={onDisconnect} disabled={disconnecting}>
                    {disconnecting ? "Removing..." : "Remove"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-sm">Connected and ready to use.</p>
                <Button variant="outline" size="sm" className="shrink-0" onClick={onDisconnect} disabled={disconnecting}>
                  {disconnecting ? "Removing..." : "Disconnect"}
                </Button>
              </div>
            )}
            {extraNote}
          </div>
        ) : (
          <div className="space-y-2">
            <Button onClick={onConnect}>{connectLabel}</Button>
            {extraNote}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Team Tab ──────────────────────────────────────────────────────────── */

function TeamTab() {
  const { status } = useSubscription();
  const { current: workspace } = useWorkspace();
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'analyst'>('member');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ uid: string; email: string } | null>(null);

  const wsId = workspace?.id ?? 'default';
  const tier = (status?.tier ?? 'starter') as PlanTier;
  const plan = PLANS[tier];
  const limit = plan.limits.teamMembers;
  const canInvite = workspace?.role === 'owner' || workspace?.role === 'admin';

  const fetchMembers = useCallback(async () => {
    const res = await apiGet<{ members: Member[] }>('/api/team', wsId);
    if (res.ok) setMembers(res.data.members);
  }, [wsId]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  async function invite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await apiPost<{ status: string; email: string }>('/api/team', { email: inviteEmail.trim(), role: inviteRole }, wsId);
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
    analyst: "View-only analytics access",
  };

  return (
    <div className="grid gap-5">
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle>Team members</CardTitle>
          <CardDescription>
            {limit === -1
              ? `Unlimited members on the ${plan.name} plan`
              : `${members.length} / ${limit} members on the ${plan.name} plan`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Member list */}
          <div className="rounded-xl border divide-y divide-border/40">
            {members.length === 0 && (
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
                    className="text-xs text-muted-foreground hover:text-rose-500 shrink-0"
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
                  placeholder="colleague@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && invite()}
                  className="flex-1"
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member' | 'analyst')}
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="member">Member</option>
                  <option value="analyst">Analyst</option>
                  <option value="admin">Admin</option>
                </select>
                <Button onClick={invite} disabled={inviting || !inviteEmail.trim()}>
                  {inviting ? 'Inviting…' : 'Invite'}
                </Button>
              </div>
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

  const [apiClients, setApiClients] = useState<ApiClientInfo[]>([]);
  const [apiClientAnalytics, setApiClientAnalytics] = useState<ApiClientAnalytics[]>([]);
  const [analyticsTotals, setAnalyticsTotals] = useState<ApiAnalyticsTotals>({
    totalRequests: 0,
    currentMonthRequests: 0,
    publishQueued: 0,
    publishSucceeded: 0,
    publishExportedForReview: 0,
    publishFailed: 0,
  });
  const [webhookEndpoints, setWebhookEndpoints] = useState<WebhookEndpointInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [createWebhookOpen, setCreateWebhookOpen] = useState(false);
  const [editKeyOpen, setEditKeyOpen] = useState(false);

  const [clientName, setClientName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['products.read', 'media.write', 'posts.write', 'posts.publish', 'job_runs.read']);
  const [editingClient, setEditingClient] = useState<ApiClientInfo | null>(null);
  const [editingScopes, setEditingScopes] = useState<string[]>([]);
  const [creatingClient, setCreatingClient] = useState(false);
  const [savingClientScopes, setSavingClientScopes] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);

  const [webhookUrl, setWebhookUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['post.published', 'post.exported_for_review', 'post.failed']);
  const [creatingWebhook, setCreatingWebhook] = useState(false);
  const [createdWebhookSecret, setCreatedWebhookSecret] = useState<string | null>(null);

  const [revokingClient, setRevokingClient] = useState<string | null>(null);
  const [disablingWebhook, setDisablingWebhook] = useState<string | null>(null);

  const fetchApiAccess = useCallback(async () => {
    if (!canManage) {
      setApiClients([]);
      setWebhookEndpoints([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [clientsRes, webhooksRes, analyticsRes] = await Promise.all([
        apiGet<{ apiClients: ApiClientInfo[] }>('/api/settings/api-clients', wsId),
        apiGet<{ webhookEndpoints: WebhookEndpointInfo[] }>('/api/settings/webhook-endpoints', wsId),
        apiGet<{ clients: ApiClientAnalytics[]; totals: ApiAnalyticsTotals }>('/api/settings/api-clients/analytics', wsId),
      ]);

      if (clientsRes.ok) setApiClients(clientsRes.data.apiClients || []);
      if (webhooksRes.ok) setWebhookEndpoints(webhooksRes.data.webhookEndpoints || []);
      if (analyticsRes.ok) {
        setApiClientAnalytics(analyticsRes.data.clients || []);
        setAnalyticsTotals(analyticsRes.data.totals || {
          totalRequests: 0,
          currentMonthRequests: 0,
          publishQueued: 0,
          publishSucceeded: 0,
          publishExportedForReview: 0,
          publishFailed: 0,
        });
      }
    } catch {
      toast.error('Failed to load API access settings');
    } finally {
      setLoading(false);
    }
  }, [canManage, wsId]);

  useEffect(() => {
    fetchApiAccess();
  }, [fetchApiAccess]);

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
    if (!clientName.trim() || selectedScopes.length === 0) return;
    setCreatingClient(true);
    try {
      const res = await apiPost<{ apiClient: ApiClientInfo; apiKey: string }>(
        '/api/settings/api-clients',
        { name: clientName.trim(), scopes: selectedScopes },
        wsId,
      );
      if (!res.ok) {
        toast.error('Failed to create API key');
        return;
      }

      setCreatedApiKey(res.data.apiKey);
      setClientName('');
      setSelectedScopes(['products.read', 'media.write', 'posts.write', 'posts.publish', 'job_runs.read']);
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
      setSelectedEvents(['post.published', 'post.exported_for_review', 'post.failed']);
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
              <p className="text-sm font-medium">Image posts only</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Public API v1 supports Facebook, Instagram, and TikTok image posts. TikTok videos stay excluded for now.
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-sm font-medium">10 image cap</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Every channel is capped at 10 images per post to keep validation and platform behavior predictable.
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-sm font-medium">TikTok review flow</p>
              <p className="mt-1 text-xs text-muted-foreground">
                TikTok exports to the user’s draft/edit flow. Meta publishes directly.
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Requests this month</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{analyticsTotals.currentMonthRequests.toLocaleString()}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatMonthKey(apiClientAnalytics[0]?.usage.currentMonth || new Date().toISOString().slice(0, 7))}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Queued publishes</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{analyticsTotals.publishQueued.toLocaleString()}</p>
              <p className="mt-1 text-xs text-muted-foreground">All keys in this workspace</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Completed outcomes</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {(analyticsTotals.publishSucceeded + analyticsTotals.publishExportedForReview).toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {analyticsTotals.publishSucceeded.toLocaleString()} direct publish · {analyticsTotals.publishExportedForReview.toLocaleString()} TikTok review exports
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Failures</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{analyticsTotals.publishFailed.toLocaleString()}</p>
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
                    {apiClientAnalytics.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                          No API keys yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      apiClientAnalytics.map((client) => (
                        <TableRow key={client.id}>
                          <TableCell className="min-w-[220px]">
                            <div className="space-y-2">
                              <p className="font-medium">{client.name}</p>
                              <p className="text-xs text-muted-foreground">{client.keyPrefix}…</p>
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
                              <p><span className="font-medium text-emerald-700 tabular-nums">{(client.usage.currentMonthCounts.publish_succeeded || 0).toLocaleString()}</span> direct publish</p>
                              <p><span className="font-medium text-primary tabular-nums">{(client.usage.currentMonthCounts.publish_exported_for_review || 0).toLocaleString()}</span> TikTok review exports</p>
                              <p><span className="font-medium text-rose-600 tabular-nums">{(client.usage.currentMonthCounts.publish_failed || 0).toLocaleString()}</span> failed</p>
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
                            <Badge className={client.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-0' : 'bg-muted text-muted-foreground border-0'}>
                              {client.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleString() : 'Never'}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1.5">
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
                                className="text-rose-600 hover:text-rose-700"
                                onClick={() => revokeClient(client.id)}
                                disabled={client.status !== 'active' || revokingClient === client.id}
                              >
                                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                {revokingClient === client.id ? 'Revoking…' : 'Revoke'}
                              </Button>
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
                    <p className="text-xs text-muted-foreground">Receive delivery events when publishes queue, complete, export for TikTok review, or fail. These are signed and retried from the worker.</p>
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
                            <Badge className={endpoint.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-0' : 'bg-muted text-muted-foreground border-0'}>
                              {endpoint.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-rose-600 hover:text-rose-700"
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
            <p className="text-sm font-medium">TikTok drafts need user completion</p>
            <p className="mt-1 text-xs text-muted-foreground">
              TikTok image posts export into the creator review flow, so final publish still happens inside TikTok.
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
            <div className="space-y-3">
              <Label>Scopes</Label>
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
            <Button onClick={createClient} disabled={creatingClient || !clientName.trim() || selectedScopes.length === 0}>
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

      <Dialog open={!!createdApiKey} onOpenChange={(open) => { if (!open) setCreatedApiKey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API key created</DialogTitle>
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
              This webhook signing secret is only shown once. Save it before you close this dialog.
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
        window.location.href = res.data.url;
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
                <Badge className="bg-emerald-50 text-emerald-700 border-0">Active</Badge>
              )}
              {status.cancelAtPeriodEnd && (
                <Badge className="bg-amber-50 text-amber-700 border-0">Cancels at period end</Badge>
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
                        <Check className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
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
