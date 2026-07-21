import { NextRequest, NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { isUuid } from '@/lib/task-evidence';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie, Authorization' };
function row(value: unknown): Record<string, unknown> | null { const item=Array.isArray(value)?value[0]:value;return typeof item==='object'&&item!==null&&!Array.isArray(item)?item as Record<string,unknown>:null; }

export async function GET(request: NextRequest) {
 const supabase=await createSupabaseServerAuth();const auth=await authorizeCompanyApiRequestFromSupabase(supabase);if(!auth.authorized)return NextResponse.json({error:'Unauthorized'},{status:auth.status,headers:HEADERS});
 const state=request.nextUrl.searchParams.get('state')==='true';
 if(state){const {data,error}=await supabase.rpc('get_my_notification_state');if(error)return NextResponse.json({error:'Notifications unavailable'},{status:503,headers:HEADERS});return NextResponse.json(row(data)??{unread_count:0,subscription_count:0,preferences:null},{headers:HEADERS});}
 const requested=Number(request.nextUrl.searchParams.get('limit')??30);const limit=Number.isInteger(requested)?Math.min(Math.max(requested,1),50):30;const before=request.nextUrl.searchParams.get('before');
 const {data,error}=await supabase.rpc('list_my_notifications',{p_limit:limit,p_before:before||null});if(error){console.error('[Notifications API] list failed',{stage:'notification.list',code:error.code,message:error.message});return NextResponse.json({error:'Notifications unavailable'},{status:503,headers:HEADERS});}
 return NextResponse.json({notifications:data??[],nextCursor:Array.isArray(data)&&data.length===limit?data[data.length-1]?.created_at??null:null},{headers:HEADERS});
}

export async function PATCH(request:NextRequest){const supabase=await createSupabaseServerAuth();const auth=await authorizeCompanyApiRequestFromSupabase(supabase);if(!auth.authorized)return NextResponse.json({error:'Unauthorized'},{status:auth.status,headers:HEADERS});const body:unknown=await request.json().catch(()=>null);if(typeof body!=='object'||body===null||Array.isArray(body))return NextResponse.json({error:'Invalid action'},{status:400,headers:HEADERS});const input=body as Record<string,unknown>;
 if(input.action==='mark_all_read'){const {data,error}=await supabase.rpc('mark_all_my_notifications_read');return error?NextResponse.json({error:'Update failed'},{status:409,headers:HEADERS}):NextResponse.json({updated:data??0},{headers:HEADERS});}
 if((input.action==='read'||input.action==='archive')&&isUuid(input.notificationId)){const {error}=await supabase.rpc('update_my_notification',{p_notification_id:input.notificationId,p_action:input.action});return error?NextResponse.json({error:'Notification unavailable'},{status:404,headers:HEADERS}):NextResponse.json({success:true},{headers:HEADERS});}
 return NextResponse.json({error:'Invalid action'},{status:400,headers:HEADERS});}

export async function POST(request:NextRequest){const supabase=await createSupabaseServerAuth();const auth=await authorizeCompanyApiRequestFromSupabase(supabase);if(!auth.authorized)return NextResponse.json({error:'Unauthorized'},{status:auth.status,headers:HEADERS});const body:unknown=await request.json().catch(()=>null);if(typeof body!=='object'||body===null||Array.isArray(body))return NextResponse.json({error:'Invalid request'},{status:400,headers:HEADERS});const input=body as Record<string,unknown>;
 if(input.action==='preferences'&&typeof input.preferences==='object'&&input.preferences!==null){const {error}=await supabase.rpc('save_my_notification_preferences',{p_preferences:input.preferences});return error?NextResponse.json({error:'Preferences rejected'},{status:400,headers:HEADERS}):NextResponse.json({success:true},{headers:HEADERS});}
 if(input.action==='subscribe'&&typeof input.endpoint==='string'&&typeof input.p256dh==='string'&&typeof input.auth==='string'){const {error}=await supabase.rpc('save_my_push_subscription',{p_endpoint:input.endpoint,p_p256dh:input.p256dh,p_auth:input.auth,p_device:typeof input.device==='string'?input.device:'browser'});return error?NextResponse.json({error:'Subscription rejected'},{status:400,headers:HEADERS}):NextResponse.json({success:true},{status:201,headers:HEADERS});}
 if(input.action==='revoke'&&typeof input.endpoint==='string'){const {error}=await supabase.rpc('revoke_my_push_subscription',{p_endpoint:input.endpoint});return error?NextResponse.json({error:'Revocation failed'},{status:409,headers:HEADERS}):NextResponse.json({success:true},{headers:HEADERS});}
 return NextResponse.json({error:'Invalid request'},{status:400,headers:HEADERS});}
