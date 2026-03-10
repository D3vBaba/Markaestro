"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Sheet, SheetContent, SheetDescription, SheetHeader,
    SheetTitle, SheetTrigger, SheetFooter, SheetClose,
} from "@/components/ui/sheet";
import { Plus, Trash2, Mail } from "lucide-react";
import PageHeader from "@/components/app/PageHeader";
import FormField from "@/components/app/FormField";
import Select from "@/components/app/Select";
import { apiGet, apiPost, apiDelete } from "@/lib/api-client";
import { toast } from "sonner";

type Campaign = {
  id: string;
  name: string;
  channel: string;
  status: string;
  targetAudience?: string;
  cta?: string;
  createdAt?: string;
};

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  scheduled: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  completed: "bg-purple-50 text-purple-700",
  cancelled: "bg-rose-50 text-rose-700",
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  // New campaign form
  const [newName, setNewName] = useState("");
  const [newChannel, setNewChannel] = useState("email");
  const [newAudience, setNewAudience] = useState("");
  const [newCta, setNewCta] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchCampaigns = async () => {
    try {
      const res = await apiGet<{ campaigns: Campaign[] }>("/api/campaigns");
      if (res.ok) setCampaigns(res.data.campaigns || []);
    } catch {
      toast.error("Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const handleCreate = async () => {
    setSaving(true);
    try {
      const res = await apiPost("/api/campaigns", {
        name: newName,
        channel: newChannel,
        targetAudience: newAudience,
        cta: newCta,
      });
      if (res.ok) {
        toast.success("Campaign created");
        setNewName(""); setNewChannel("email"); setNewAudience(""); setNewCta("");
        fetchCampaigns();
      } else {
        const errData = res.data as { error?: string; issues?: { field: string; message: string }[] };
        toast.error(errData.issues?.[0]?.message || errData.error || "Failed to create campaign");
      }
    } catch {
      toast.error("Failed to create campaign");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await apiDelete(`/api/campaigns/${id}`);
    if (res.ok) {
      toast.success("Campaign deleted");
      fetchCampaigns();
    } else {
      const errData = res.data as { error?: string };
      toast.error(errData.error || "Failed to delete campaign");
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Campaigns"
        subtitle="Plan and ship high-converting multi-channel campaigns."
        action={
          <Sheet>
            <SheetTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> New Campaign</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Create Campaign</SheetTitle>
                <SheetDescription>Set up a new marketing campaign.</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                <FormField label="Name">
                  <Input placeholder="Spring Reactivation" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </FormField>
                <FormField label="Channel">
                  <Select value={newChannel} onChange={(e) => setNewChannel(e.target.value)}>
                    <option value="email">Email</option>
                    <option value="x">X (Twitter)</option>
                    <option value="facebook">Facebook</option>
                    <option value="instagram">Instagram</option>
                    <option value="tiktok">TikTok</option>
                    <option value="sms">SMS</option>
                  </Select>
                </FormField>
                <FormField label="Target Audience">
                  <Input placeholder="Dormant Users" value={newAudience} onChange={(e) => setNewAudience(e.target.value)} />
                </FormField>
                <FormField label="Call to Action">
                  <Input placeholder="Start trial" value={newCta} onChange={(e) => setNewCta(e.target.value)} />
                </FormField>
              </div>
              <SheetFooter>
                <SheetClose asChild>
                  <Button onClick={handleCreate} disabled={saving}>{saving ? "Creating..." : "Create Campaign"}</Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        }
      />

      <div className="grid gap-4">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-xl border bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <Card className="border">
            <CardContent className="py-16 text-center">
              <Mail className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-base font-medium text-foreground">No campaigns yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create your first campaign to get started.</p>
            </CardContent>
          </Card>
        ) : (
          campaigns.map((c) => (
            <Card key={c.id} className="border transition-all duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,0.04)]">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{c.name}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`capitalize border-0 ${statusColors[c.status] || ""}`}>
                      {c.status}
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(c.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardTitle>
                <CardDescription className="capitalize">{c.channel} {c.targetAudience ? `• ${c.targetAudience}` : ""}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Primary CTA: <span className="text-foreground font-medium">{c.cta || "Learn more"}</span>
                {c.createdAt && (
                  <span className="ml-4 text-xs text-muted-foreground">Created {new Date(c.createdAt).toLocaleDateString()}</span>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
