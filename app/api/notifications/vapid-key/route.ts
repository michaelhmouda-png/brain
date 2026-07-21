import { NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';import { createSupabaseServerAuth } from '@/lib/supabaseServer';
export const dynamic='force-dynamic';
export async function GET(){const supabase=await createSupabaseServerAuth();const auth=await authorizeCompanyApiRequestFromSupabase(supabase);if(!auth.authorized)return NextResponse.json({error:'Unauthorized'},{status:auth.status});const publicKey=process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;if(!publicKey)return NextResponse.json({error:'Push unavailable'},{status:503});return NextResponse.json({publicKey},{headers:{'Cache-Control':'private, no-store'}});}

