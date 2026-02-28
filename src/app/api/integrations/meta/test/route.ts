import { NextResponse } from 'next/server';
import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';

export async function POST(req: Request){
  try{
    const ctx=await requireContext(req);
    const body=await req.json();
    const provider=String(body.provider||'facebook');
    if(!['facebook','instagram'].includes(provider)) return NextResponse.json({error:'INVALID_PROVIDER'},{status:400});

    const doc=await adminDb.doc(`workspaces/${ctx.workspaceId}/integrations/${provider}`).get();
    const cfg=doc.data()||{};
    const token=String(cfg.accessToken||'');
    if(!token) return NextResponse.json({error:'MISSING_META_TOKEN'},{status:400});

    const r=await fetch(`https://graph.facebook.com/v20.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
    const data=await r.json();
    return NextResponse.json({ok:r.ok,status:r.status,data});
  }catch(e:any){
    return NextResponse.json({error:e?.message||'Internal error'},{status:500});
  }
}
