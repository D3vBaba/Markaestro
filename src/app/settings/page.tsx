"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { apiGet, apiPost } from "@/lib/api-client";
import { toast } from "sonner";

type IntegrationInfo = {
  provider: string;
  enabled: boolean;
  status: string;
  hasApiKey: boolean;
  hasAccessToken: boolean;
  fromEmail?: string;
};

export default function SettingsPage() {
  const [resendKey, setResendKey] = useState("");
  const [resendFrom, setResendFrom] = useState("");
  const [testEmail, setTestEmail] = useState("");

  const [fbToken, setFbToken] = useState("");
  const [igToken, setIgToken] = useState("");

  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);

  useEffect(() => {
    (async () => {
      const res = await apiGet<{ integrations: IntegrationInfo[] }>("/api/integrations");
      if (res.ok) {
        const list = res.data.integrations || [];
        setIntegrations(list);
        const r = list.find((x) => x.provider === "resend");
        if (r?.fromEmail) setResendFrom(r.fromEmail);
      }
    })();
  }, []);

  const isConnected = (provider: string) =>
    integrations.find((i) => i.provider === provider)?.status === "connected";

  async function saveResend() {
    const res = await apiPost("/api/integrations/resend", {
      apiKey: resendKey,
      fromEmail: resendFrom,
      enabled: true,
    });
    if (res.ok) {
      toast.success("Resend connected");
      setResendKey(""); // Clear key from UI after save
    } else {
      const errData = res.data as { error?: string; issues?: { field: string; message: string }[] };
      toast.error(errData.issues?.[0]?.message || errData.error || "Failed to save Resend config");
    }
  }

  async function testResend() {
    if (!testEmail) {
      toast.error("Enter a test email address");
      return;
    }
    const res = await apiPost<{ ok: boolean; status: number }>("/api/integrations/resend/test", { to: testEmail });
    if (res.ok && res.data.ok) {
      toast.success("Test email sent");
    } else {
      toast.error("Resend test failed");
    }
  }

  async function saveMeta(provider: "facebook" | "instagram", token: string) {
    const res = await apiPost(`/api/integrations/${provider}`, {
      accessToken: token,
      enabled: true,
    });
    if (res.ok) {
      toast.success(`${provider} connected`);
      if (provider === "facebook") setFbToken("");
      else setIgToken("");
    } else {
      const errData = res.data as { error?: string; issues?: { field: string; message: string }[] };
      toast.error(errData.issues?.[0]?.message || errData.error || `Failed to save ${provider}`);
    }
  }

  async function testMeta(provider: "facebook" | "instagram") {
    const res = await apiPost<{ ok: boolean; status: number }>("/api/integrations/meta/test", { provider });
    if (res.ok && res.data.ok) {
      toast.success(`${provider} connection verified`);
    } else {
      toast.error(`${provider} test failed`);
    }
  }

  return (
    <AppShell>
      <PageHeader title="Settings" subtitle="Integrations and workspace configuration." />

      <div className="grid gap-6">
        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Resend Email Integration</CardTitle>
                <CardDescription>Connect campaign email sending.</CardDescription>
              </div>
              {isConnected("resend") && <Badge className="bg-emerald-50 text-emerald-700 border-0">Connected</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="password"
              placeholder={isConnected("resend") ? "API key saved (enter new to replace)" : "Resend API key (re_...)"}
              value={resendKey}
              onChange={(e) => setResendKey(e.target.value)}
            />
            <Input
              placeholder="From email (e.g. Support <support@domain.com>)"
              value={resendFrom}
              onChange={(e) => setResendFrom(e.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={saveResend}>Save Resend</Button>
              <Input
                className="max-w-sm"
                placeholder="Test recipient email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
              />
              <Button variant="outline" onClick={testResend}>Send Test</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Facebook Integration</CardTitle>
                <CardDescription>Connect Meta Graph for campaigns and diagnostics.</CardDescription>
              </div>
              {isConnected("facebook") && <Badge className="bg-emerald-50 text-emerald-700 border-0">Connected</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="password"
              placeholder={isConnected("facebook") ? "Token saved (enter new to replace)" : "Facebook access token"}
              value={fbToken}
              onChange={(e) => setFbToken(e.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={() => saveMeta("facebook", fbToken)}>Save Facebook</Button>
              <Button variant="outline" onClick={() => testMeta("facebook")}>Test Facebook</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Instagram Integration</CardTitle>
                <CardDescription>Connect Instagram via Meta token.</CardDescription>
              </div>
              {isConnected("instagram") && <Badge className="bg-emerald-50 text-emerald-700 border-0">Connected</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="password"
              placeholder={isConnected("instagram") ? "Token saved (enter new to replace)" : "Instagram access token"}
              value={igToken}
              onChange={(e) => setIgToken(e.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={() => saveMeta("instagram", igToken)}>Save Instagram</Button>
              <Button variant="outline" onClick={() => testMeta("instagram")}>Test Instagram</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>X (Twitter)</CardTitle>
            <CardDescription>Publishing integration for X is queued.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">Coming soon</Badge>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
