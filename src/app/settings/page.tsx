"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/components/providers/AuthProvider";

export default function SettingsPage() {
  const { getIdToken } = useAuth();
  const [status, setStatus] = useState("");

  const [resendKey, setResendKey] = useState("");
  const [resendFrom, setResendFrom] = useState("");
  const [testEmail, setTestEmail] = useState("rcsamaambe@gmail.com");

  const [fbToken, setFbToken] = useState("");
  const [igToken, setIgToken] = useState("");

  async function authed(path:string, init:RequestInit={}){
    const token = await getIdToken();
    return fetch(path, {
      ...init,
      headers: { 'Content-Type':'application/json', ...(init.headers||{}), ...(token ? { Authorization:`Bearer ${token}` }: {}) }
    });
  }

  useEffect(() => {
    (async () => {
      const res = await authed('/api/integrations?workspaceId=default');
      const data = await res.json();
      const list = data.integrations || [];
      const r = list.find((x:any)=>x.provider==='resend');
      const f = list.find((x:any)=>x.provider==='facebook');
      const i = list.find((x:any)=>x.provider==='instagram');
      if(r){ setResendFrom(r.fromEmail||''); setResendKey(r.apiKey||''); }
      if(f){ setFbToken(f.accessToken||''); }
      if(i){ setIgToken(i.accessToken||''); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveResend(){
    const r = await authed('/api/integrations/resend?workspaceId=default',{method:'POST',body:JSON.stringify({apiKey:resendKey,fromEmail:resendFrom,enabled:true})});
    setStatus(r.ok ? 'Resend connected' : 'Resend save failed');
  }

  async function testResend(){
    const r=await authed('/api/integrations/resend/test?workspaceId=default',{method:'POST',body:JSON.stringify({to:testEmail})});
    const d=await r.json();
    setStatus(r.ok ? `Resend test: ${d.ok ? 'sent' : 'failed'} (${d.status||''})` : 'Resend test failed');
  }

  async function saveMeta(provider:'facebook'|'instagram', token:string){
    const r=await authed(`/api/integrations/${provider}?workspaceId=default`,{method:'POST',body:JSON.stringify({accessToken:token,enabled:true})});
    setStatus(r.ok ? `${provider} connected` : `${provider} save failed`);
  }

  async function testMeta(provider:'facebook'|'instagram'){
    const r=await authed('/api/integrations/meta/test?workspaceId=default',{method:'POST',body:JSON.stringify({provider})});
    const d=await r.json();
    setStatus(`${provider} test: ${r.ok && d.ok ? 'ok' : 'failed'} (${d.status||''})`);
  }

  return (
    <AppShell>
      <PageHeader title="Settings" subtitle="Integrations and workspace configuration." />

      <div className="grid gap-6">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Resend Email Integration</CardTitle>
            <CardDescription>Connect campaign email sending.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Resend API key (re_...)" value={resendKey} onChange={(e)=>setResendKey(e.target.value)} />
            <Input placeholder="From email (e.g. Support <support@domain.com>)" value={resendFrom} onChange={(e)=>setResendFrom(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={saveResend}>Save Resend</Button>
              <Input className="max-w-sm" placeholder="Test email" value={testEmail} onChange={(e)=>setTestEmail(e.target.value)} />
              <Button variant="outline" onClick={testResend}>Send Test</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Facebook Integration</CardTitle>
            <CardDescription>Connect Meta Graph for campaigns and diagnostics.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Facebook access token" value={fbToken} onChange={(e)=>setFbToken(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={()=>saveMeta('facebook', fbToken)}>Save Facebook</Button>
              <Button variant="outline" onClick={()=>testMeta('facebook')}>Test Facebook</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Instagram Integration</CardTitle>
            <CardDescription>Connect Instagram via Meta token.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Instagram access token" value={igToken} onChange={(e)=>setIgToken(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={()=>saveMeta('instagram', igToken)}>Save Instagram</Button>
              <Button variant="outline" onClick={()=>testMeta('instagram')}>Test Instagram</Button>
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

        {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      </div>
    </AppShell>
  );
}
