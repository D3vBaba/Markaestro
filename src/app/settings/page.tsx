"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/app/PageHeader";
import { apiGet, apiPost, apiFetch, apiDelete } from "@/lib/api-client";
import { toast } from "sonner";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { PLANS } from "@/lib/stripe/plans";
import type { PlanTier } from "@/lib/stripe/plans";
import { cn } from "@/lib/utils";

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
  role: 'owner' | 'admin' | 'member';
  joinedAt?: string;
};

type WorkspaceInfo = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
};

const TABS = ['Integrations', 'Team', 'Workspaces', 'Billing'] as const;
type Tab = typeof TABS[number];

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams?.get('tab') === 'workspaces' ? 'Workspaces'
    : searchParams?.get('tab') === 'team' ? 'Team'
    : 'Integrations') as Tab;
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  return (
    <AppShell>
      <PageHeader title="Settings" subtitle="Manage your billing, team, workspaces, and connected accounts." />

      {/* Tab bar */}
      <div className="flex gap-1 border-b mb-6">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Integrations' && <IntegrationsTab />}
      {activeTab === 'Team' && <TeamTab />}
      {activeTab === 'Workspaces' && <WorkspacesTab />}
      {activeTab === 'Billing' && <BillingCard />}
    </AppShell>
  );
}

/* ─── Integrations Tab ──────────────────────────────────────────────────── */

function IntegrationsTab() {
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

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

  async function disconnectProvider(provider: string) {
    setDisconnecting(provider);
    try {
      const res = await apiPost(`/api/oauth/disconnect/${provider}`, {});
      if (res.ok) {
        toast.success(`${provider === "meta" ? "Meta" : provider === "google" ? "Google Ads" : provider} disconnected`);
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
      {/* Meta */}
      <IntegrationCard
        title="Meta (Facebook + Instagram)"
        description="Publish posts and run ad campaigns on Facebook and Instagram."
        connected={isConnected("meta")}
        needsReconnect={needsReconnect("meta")}
        reconnectNote="Your Meta connection needs to be refreshed"
        onConnect={() => startOAuth("meta")}
        onDisconnect={() => disconnectProvider("meta")}
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

      {/* Google Ads */}
      <IntegrationCard
        title="Google Ads"
        description="Create and manage ad campaigns on Google Search, Display, and YouTube."
        connected={isConnected("google")}
        needsReconnect={needsReconnect("google")}
        reconnectNote="Your Google Ads connection needs to be refreshed"
        onConnect={() => startOAuth("google")}
        onDisconnect={() => disconnectProvider("google")}
        disconnecting={disconnecting === "google"}
        connectLabel="Connect Google Ads"
      />

      <p className="text-xs text-muted-foreground">
        TikTok and TikTok Ads integrations are set up per product on the{" "}
        <a href="/products" className="text-primary hover:underline">Products page</a>.
      </p>
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
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

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

  async function removeMember(uid: string) {
    setRemoving(uid);
    try {
      const res = await apiFetch(`/api/team/${uid}?workspaceId=${wsId}`, { method: 'DELETE' });
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
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{m.email}</p>
                  <p className="text-xs text-muted-foreground capitalize">{m.role}</p>
                </div>
                {canInvite && m.role !== 'owner' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-rose-500 shrink-0"
                    onClick={() => removeMember(m.uid)}
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
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <Input
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && invite()}
                className="flex-1"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <Button onClick={invite} disabled={inviting || !inviteEmail.trim()}>
                {inviting ? 'Inviting…' : 'Invite'}
              </Button>
            </div>
          )}

          {canInvite && limit !== -1 && members.length >= limit && (
            <p className="text-xs text-muted-foreground pt-1">
              Team member limit reached.{' '}
              <a href="/settings?tab=Billing" className="text-primary hover:underline">Upgrade your plan</a> to invite more.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Workspaces Tab ────────────────────────────────────────────────────── */

function WorkspacesTab() {
  const { status } = useSubscription();
  const { workspaces, current, switchWorkspace, refresh } = useWorkspace();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

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
                  <p className="text-sm font-medium truncate">{ws.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{ws.role}</p>
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
            <div className="flex gap-2 pt-1">
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
          )}

          {!canCreate && (
            <p className="text-xs text-muted-foreground pt-1">
              Workspace limit reached.{' '}
              <a href="/settings?tab=Billing" className="text-primary hover:underline">Upgrade your plan</a> to create more.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Billing Card ──────────────────────────────────────────────────────── */

function BillingCard() {
  const { status, trialDaysLeft } = useSubscription();
  const [busy, setBusy] = useState(false);

  if (!status) return null;

  const plan = status.tier ? PLANS[status.tier as PlanTier] : null;

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
              <Button variant="outline" size="sm" className="shrink-0" onClick={openPortal} disabled={busy}>
                {busy ? "Opening..." : "Manage Billing"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
