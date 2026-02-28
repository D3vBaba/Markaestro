import { NextResponse } from 'next/server';
import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';

function err(e:any){
  const m=e?.message||'Internal error';
  if(m==='UNAUTHENTICATED') return NextResponse.json({error:m},{status:401});
  if(m==='FORBIDDEN_WORKSPACE') return NextResponse.json({error:m},{status:403});
  return NextResponse.json({error:m},{status:500});
}

export async function GET(req: Request){
  try{
    const ctx=await requireContext(req);
    const snap=await adminDb.collection(`workspaces/${ctx.workspaceId}/integrations`).get();
    const items=snap.docs.map(d=>({provider:d.id,...d.data()}));
    return NextResponse.json({workspaceId:ctx.workspaceId,integrations:items});
  }catch(e:any){return err(e)}
}
