import { NextResponse } from 'next/server';
import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';

const ALLOWED = new Set(['resend','facebook','instagram','x']);

function sanitize(provider:string, body:any){
  if(provider==='resend'){
    return {
      fromEmail: String(body.fromEmail||''),
      apiKey: String(body.apiKey||''),
      enabled: Boolean(body.enabled ?? true),
    };
  }
  if(provider==='facebook' || provider==='instagram'){
    return {
      accessToken: String(body.accessToken||''),
      adAccountId: String(body.adAccountId||''),
      pageId: String(body.pageId||''),
      igAccountId: String(body.igAccountId||''),
      enabled: Boolean(body.enabled ?? true),
    };
  }
  return { enabled:false, comingSoon:true };
}

function err(e:any){
  const m=e?.message||'Internal error';
  if(m==='UNAUTHENTICATED') return NextResponse.json({error:m},{status:401});
  if(m==='FORBIDDEN_WORKSPACE') return NextResponse.json({error:m},{status:403});
  if(m==='INVALID_PROVIDER') return NextResponse.json({error:m},{status:400});
  return NextResponse.json({error:m},{status:500});
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try{
    const ctx=await requireContext(req);
    const {provider}=await params;
    if(!ALLOWED.has(provider)) throw new Error('INVALID_PROVIDER');
    const body=await req.json();
    const payload={
      provider,
      ...sanitize(provider, body),
      updatedAt:new Date().toISOString(),
      updatedBy:ctx.uid,
      status: provider==='x' ? 'coming_soon' : 'connected',
    };
    await adminDb.doc(`workspaces/${ctx.workspaceId}/integrations/${provider}`).set(payload,{merge:true});
    return NextResponse.json({ok:true,...payload});
  }catch(e:any){return err(e)}
}
