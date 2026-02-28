"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/components/providers/AuthProvider";

type Job = { id: string; name: string; type: string; enabled: boolean; schedule: string; nextRunAt?: string | null };

export default function JobsPage() {
  const { getIdToken } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [name, setName] = useState("Daily Campaign Dispatch");
  const [loading, setLoading] = useState(false);

  async function loadJobs() {
    const token = await getIdToken();
    const res = await fetch('/api/jobs?workspaceId=default', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const data = await res.json();
    setJobs(data.jobs || []);
  }

  useEffect(() => { loadJobs(); }, []);

  async function createJob() {
    setLoading(true);
    try {
      const token = await getIdToken();
      await fetch('/api/jobs?workspaceId=default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          name,
          type: 'send_email_campaign',
          schedule: 'daily',
          hourUTC: 15,
          minuteUTC: 0,
          enabled: true,
          payload: { campaignName: name },
        }),
      });
      await loadJobs();
    } finally { setLoading(false); }
  }

  async function runNow(id: string) {
    const token = await getIdToken();
    await fetch(`/api/jobs/${id}/run?workspaceId=default`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    await loadJobs();
  }

  return (
    <AppShell>
      <PageHeader title="Jobs" subtitle="Queue, schedule, and run backend automation tasks." />

      <Card className="mb-6 shadow-sm">
        <CardHeader><CardTitle>Create Job</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row">
          <Input value={name} onChange={(e)=>setName(e.target.value)} placeholder="Job name" className="max-w-md" />
          <Button disabled={loading} onClick={createJob}>{loading ? 'Creating...' : 'Create Daily Job'}</Button>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {jobs.map((job) => (
          <Card key={job.id} className="shadow-sm">
            <CardContent className="flex flex-col gap-3 py-6 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{job.name}</p>
                  <Badge variant="outline">{job.type}</Badge>
                  <Badge variant={job.enabled ? 'default' : 'secondary'}>{job.enabled ? 'enabled' : 'disabled'}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Schedule: {job.schedule} • Next run: {job.nextRunAt || 'manual'}</p>
              </div>
              <Button variant="outline" onClick={() => runNow(job.id)}>Run now</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
