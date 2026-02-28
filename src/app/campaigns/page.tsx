"use client";

import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import PageHeader from "@/components/app/PageHeader";

type Campaign = {
  id: string;
  name: string;
  channel: string;
  status: string;
  targetAudience?: string;
  cta?: string;
};

const fallback: Campaign[] = [
  { id: "1", name: "Spring Reactivation", channel: "Email", status: "scheduled", targetAudience: "Dormant Users", cta: "Resume plan" },
  { id: "2", name: "DripCheckr Launch Push", channel: "X", status: "active", targetAudience: "Founders + Agencies", cta: "Start trial" },
  { id: "3", name: "EyeCash Feature Drop", channel: "TikTok", status: "draft", targetAudience: "Ecom Operators", cta: "Book demo" },
];

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>(fallback);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  const { getIdToken } = useAuth();

  useEffect(() => {
    (async () => {
      try {
        const token = await getIdToken();
        const res = await fetch('/api/campaigns?workspaceId=default', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error('Failed to load campaigns');
        const data = await res.json();
        if (Array.isArray(data.campaigns) && data.campaigns.length) {
          setCampaigns(data.campaigns as Campaign[]);
        }
      } catch (e: any) {
        setAuthError(e?.message || "Failed to load campaigns");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <AppShell>
      <PageHeader
        title="Campaigns"
        subtitle="Plan and ship high-converting multi-channel campaigns."
        action={<Button>New Campaign</Button>}
      />

      <div className="grid gap-4">
        {campaigns.map((c) => (
          <Card key={c.id} className="shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{c.name}</span>
                <Badge variant="outline" className="capitalize">{c.status}</Badge>
              </CardTitle>
              <CardDescription>{c.channel} • {c.targetAudience || 'General Audience'}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Primary CTA: <span className="text-foreground font-medium">{c.cta || 'Learn more'}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {loading ? <p className="text-xs text-muted-foreground mt-4">Loading from Firebase…</p> : null}
      {authError ? <p className="text-xs text-rose-600 mt-2">{authError}</p> : null}
    </AppShell>
  );
}
