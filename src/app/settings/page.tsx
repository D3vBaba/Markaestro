"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { apiGet, apiPost, apiFetch } from "@/lib/api-client";
import { toast } from "sonner";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { PLANS } from "@/lib/stripe/plans";
import type { PlanTier } from "@/lib/stripe/plans";

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

export default function SettingsPage() {
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const fetchIntegrations = async () => {
    const res = await apiGet<{ integrations: IntegrationInfo[] }>("/api/integrations");
    if (res.ok) {
      setIntegrations(res.data.integrations || []);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("oauth");
    const provider = params.get("provider");
    const message = params.get("message");

    if (oauthResult === "success" && provider) {
      toast.success(`${provider === "meta" ? "Meta" : provider} connected successfully`);
      window.history.replaceState({}, "", "/settings");
      setTimeout(() => fetchIntegrations(), 500);
    } else if (oauthResult === "error" && provider) {
      toast.error(`Failed to connect ${provider === "meta" ? "Meta" : provider}${message ? `: ${message}` : ""}`);
      window.history.replaceState({}, "", "/settings");
      fetchIntegrations();
    } else {
      fetchIntegrations();
    }
  }, []);

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
        const errData = res.data as unknown as { error?: string };
        toast.error(errData.error || `Failed to connect`);
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
    <AppShell>
      <PageHeader title="Settings" subtitle="Manage your billing, connected accounts, and workspace preferences." />

      <div className="grid gap-5">
        {/* Billing */}
        <BillingCard />

        {/* Meta (Facebook + Instagram) */}
        <Card className="border-border/30">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle>Meta (Facebook + Instagram)</CardTitle>
                <CardDescription>
                  Publish posts and run ad campaigns on Facebook and Instagram.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {needsReconnect("meta") && (
                  <Badge className="bg-amber-50 text-amber-700 border-0">
                    Action needed
                  </Badge>
                )}
                {isConnected("meta") && !needsReconnect("meta") && (
                  <Badge className="bg-emerald-50 text-emerald-700 border-0">Connected</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {isConnected("meta") ? (
              <div className="rounded-xl border p-4 space-y-3">
                {needsReconnect("meta") ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-amber-700">Your Meta connection needs to be refreshed</p>
                    <p className="text-xs text-muted-foreground">
                      This usually happens when permissions change or after an extended period. Reconnect to restore publishing.
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" onClick={() => startOAuth("meta")}>
                        Reconnect
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => disconnectProvider("meta")}
                        disabled={disconnecting === "meta"}
                      >
                        {disconnecting === "meta" ? "Removing..." : "Remove"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-sm">Your Meta account is connected and ready to use.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => disconnectProvider("meta")}
                      disabled={disconnecting === "meta"}
                    >
                      {disconnecting === "meta" ? "Removing..." : "Disconnect"}
                    </Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Choose which Facebook page each product posts to in{" "}
                  <a href="/products" className="text-primary hover:underline">Products → Edit</a>.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Button onClick={() => startOAuth("meta")}>Connect Meta account</Button>
                <p className="text-xs text-muted-foreground">
                  One connection covers all your products. You can assign a different Facebook page to each product afterwards.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Google Ads */}
        <Card className="border-border/30">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle>Google Ads</CardTitle>
                <CardDescription>Create and manage ad campaigns on Google Search, Display, and YouTube.</CardDescription>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {needsReconnect("google") && (
                  <Badge className="bg-amber-50 text-amber-700 border-0">
                    Action needed
                  </Badge>
                )}
                {isConnected("google") && !needsReconnect("google") && (
                  <Badge className="bg-emerald-50 text-emerald-700 border-0">Connected</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {isConnected("google") ? (
              <div className="rounded-xl border p-4">
                {needsReconnect("google") ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-amber-700">Your Google Ads connection needs to be refreshed</p>
                    <p className="text-xs text-muted-foreground">
                      Reconnect to continue managing your ad campaigns.
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" onClick={() => startOAuth("google")}>
                        Reconnect
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => disconnectProvider("google")}
                        disabled={disconnecting === "google"}
                      >
                        {disconnecting === "google" ? "Removing..." : "Remove"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-sm">Your Google Ads account is connected and ready to use.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => disconnectProvider("google")}
                      disabled={disconnecting === "google"}
                    >
                      {disconnecting === "google" ? "Removing..." : "Disconnect"}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <Button onClick={() => startOAuth("google")}>
                Connect Google Ads
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Other integrations note */}
        <p className="text-xs text-muted-foreground">
          TikTok and TikTok Ads integrations are set up per product on the{" "}
          <a href="/products" className="text-primary hover:underline">Products page</a>.
        </p>
      </div>
    </AppShell>
  );
}

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
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={openPortal}
              disabled={busy}
            >
              {busy ? "Opening..." : "Manage Billing"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
