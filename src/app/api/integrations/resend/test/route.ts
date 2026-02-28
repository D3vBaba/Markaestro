import { NextResponse } from 'next/server';
import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';

export async function POST(req: Request){
  try{
    const ctx=await requireContext(req);
    const body=await req.json();
    const to=String(body.to||'').trim();
    const doc=await adminDb.doc(`workspaces/${ctx.workspaceId}/integrations/resend`).get();
    const cfg=doc.data()||{};
    const apiKey=String(cfg.apiKey||'');
    const from=String(cfg.fromEmail||'');
    if(!apiKey || !from || !to) return NextResponse.json({error:'MISSING_RESEND_CONFIG'},{status:400});

    const resp=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body: JSON.stringify({
        from,
        to:[to],
        subject:'Markaestro integration test',
        html:'<p>Resend integration is connected from Markaestro.</p>'
      })
    });
    const data=await resp.json();
    return NextResponse.json({ok:resp.ok,status:resp.status,data});
  }catch(e:any){
    return NextResponse.json({error:e?.message||'Internal error'},{status:500});
  }
}
