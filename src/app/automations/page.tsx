"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Sheet, SheetContent, SheetDescription, SheetHeader,
    SheetTitle, SheetTrigger, SheetFooter, SheetClose,
} from "@/components/ui/sheet";
import PageHeader from "@/components/app/PageHeader";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api-client";
import { toast } from "sonner";

type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  triggerType: string;
  createdAt?: string;
};

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newTrigger, setNewTrigger] = useState("manual");
  const [saving, setSaving] = useState(false);

  const fetchAutomations = async () => {
    try {
      const res = await apiGet<{ automations: Automation[] }>("/api/automations");
      if (res.ok) setAutomations(res.data.automations || []);
    } catch {
      toast.error("Failed to load automations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAutomations();
  }, []);

  const handleCreate = async () => {
    setSaving(true);
    try {
      const res = await apiPost("/api/automations", {
        name: newName,
        triggerType: newTrigger,
        enabled: false,
      });
      if (res.ok) {
        toast.success("Automation created");
        setNewName(""); setNewTrigger("manual");
        fetchAutomations();
      } else {
        const errData = res.data as { error?: string; issues?: { field: string; message: string }[] };
        toast.error(errData.issues?.[0]?.message || errData.error || "Failed to create");
      }
    } catch {
      toast.error("Failed to create automation");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    const res = await apiPut(`/api/automations/${id}`, { enabled });
    if (res.ok) {
      setAutomations((prev) => prev.map((a) => (a.id === id ? { ...a, enabled } : a)));
      toast.success(enabled ? "Automation enabled" : "Automation disabled");
    }
  };

  const handleDelete = async (id: string) => {
    const res = await apiDelete(`/api/automations/${id}`);
    if (res.ok) {
      toast.success("Automation deleted");
      fetchAutomations();
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Automations"
        subtitle="Control lifecycle flows and trigger-based outreach."
        action={
          <Sheet>
            <SheetTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> New Automation</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Create Automation</SheetTitle>
                <SheetDescription>Set up a new workflow automation.</SheetDescription>
              </SheetHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input placeholder="Lead Nurture Sequence" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Trigger Type</label>
                  <select value={newTrigger} onChange={(e) => setNewTrigger(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="manual">Manual</option>
                    <option value="event">Event-based</option>
                    <option value="schedule">Scheduled</option>
                    <option value="segment">Segment-based</option>
                  </select>
                </div>
              </div>
              <SheetFooter>
                <SheetClose asChild>
                  <Button onClick={handleCreate} disabled={saving}>{saving ? "Creating..." : "Create"}</Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        }
      />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Workflow Toggles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading automations...</p>
          ) : automations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No automations yet. Create one to get started.</p>
          ) : (
            automations.map((item) => (
              <div key={item.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{item.name}</span>
                  <Badge variant="outline" className="w-fit text-xs capitalize">{item.triggerType}</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={item.enabled} onCheckedChange={(checked) => handleToggle(item.id, checked)} />
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(item.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
