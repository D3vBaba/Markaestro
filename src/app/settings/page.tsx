"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { apiGet, apiPost } from "@/lib/api-client";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

type IntegrationInfo = {
  provider: string;
  enabled: boolean;
  status: string;
  hasApiKey: boolean;
  hasAccessToken: boolean;
  fromEmail?: string;
  oauthConnected?: boolean;
  tokenExpiresAt?: string | null;
  lastRefreshError?: string | null;
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
    fetchIntegrations();

    // Check for OAuth callback results (Google only at workspace level)
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("oauth");
    const provider = params.get("provider");
    const message = params.get("message");

    if (oauthResult === "success" && provider) {
      toast.success(`${provider} connected successfully via OAuth`);
      window.history.replaceState({}, "", "/settings");
      fetchIntegrations();
    } else if (oauthResult === "error" && provider) {
      toast.error(`${provider} OAuth failed: ${message || "Unknown error"}`);
      window.history.replaceState({}, "", "/settings");
    }
  }, []);

  const isConnected = (provider: string) =>
    integrations.find((i) => i.provider === provider)?.status === "connected";

  const getIntegration = (provider: string) =>
    integrations.find((i) => i.provider === provider);

  const needsReconnect = (provider: string) =>
    getIntegration(provider)?.lastRefreshError != null;

  async function startOAuth(provider: string) {
    try {
      const res = await apiPost<{ authUrl: string }>(`/api/oauth/authorize/${provider}`, {});
      if (res.ok && res.data.authUrl) {
        window.location.href = res.data.authUrl;
      } else {
        const errData = res.data as unknown as { error?: string };
        toast.error(errData.error || `Failed to start ${provider} OAuth`);
      }
    } catch {
      toast.error(`Failed to start ${provider} OAuth`);
    }
  }

  async function disconnectProvider(provider: string) {
    setDisconnecting(provider);
    try {
      const res = await apiPost(`/api/oauth/disconnect/${provider}`, {});
      if (res.ok) {
        toast.success(`${provider} disconnected`);
        fetchIntegrations();
      } else {
        toast.error(`Failed to disconnect ${provider}`);
      }
    } catch {
      toast.error(`Failed to disconnect ${provider}`);
    } finally {
      setDisconnecting(null);
    }
  }

  return (
    <AppShell>
      <PageHeader title="Settings" subtitle="Integrations and workspace configuration." />

      <div className="grid gap-5">
        {/* Google Ads */}
        <Card className="border-border/30">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Google Ads Integration</CardTitle>
                <CardDescription>Connect Google Ads for ad campaign management across all products.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {needsReconnect("google") && (
                  <Badge className="bg-amber-50 text-amber-700 border-0">
                    <AlertTriangle className="h-3 w-3 mr-1" /> Reconnect
                  </Badge>
                )}
                {isConnected("google") && <Badge className="bg-emerald-50 text-emerald-700 border-0">Connected</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {isConnected("google") ? (
              <div className="rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Connected via OAuth</p>
                    {getIntegration("google")?.tokenExpiresAt && (
                      <p className="text-xs text-muted-foreground">
                        Token expires: {new Date(getIntegration("google")!.tokenExpiresAt!).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => disconnectProvider("google")}
                    disabled={disconnecting === "google"}
                  >
                    {disconnecting === "google" ? "Disconnecting..." : "Disconnect"}
                  </Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => startOAuth("google")}>
                Connect with Google
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Email (Resend), Meta, X, and TikTok integrations are configured per product on the{" "}
              <a href="/products" className="text-primary hover:underline">Products page</a>.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
