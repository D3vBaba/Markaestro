"use client";

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/app/PageHeader";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import { apiGet, apiPost, apiPut, apiFetch } from "@/lib/api-client";
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

const TABS = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'usage', label: 'Usage', icon: BarChart3 },
  { id: 'integrations', label: 'Integrations', icon: Link2 },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'workspaces', label: 'Workspaces', icon: Building2 },
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
    videoGenerations: UsageMetric;
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
            videoGenerations: UsageMetric;
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

          {/* Video Generations */}
          <UsageMeter
            label="Video generations"
            current={usage?.videoGenerations.current ?? 0}
            limit={usage?.videoGenerations.limit ?? plan.limits.videoGenerations}
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

      <IntegrationCard
        title="Google Ads"
        description="Create and manage ad campaigns on Google Search, Display, and YouTube."
        connected={isConnected("google")}
        needsReconnect={needsReconnect("google")}
        reconnectNote="Your Google Ads connection needs to be refreshed"
        onConnect={() => startOAuth("google")}
        onDisconnect={() => setDisconnectTarget({ provider: "google", label: "Google Ads" })}
        disconnecting={disconnecting === "google"}
        connectLabel="Connect Google Ads"
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
