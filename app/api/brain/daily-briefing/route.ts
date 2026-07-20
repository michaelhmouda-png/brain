import { NextResponse } from 'next/server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { DailyBriefingService } from '@/lib/dailyBriefingService';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie, Authorization',
};

export async function GET() {
  try {
    // 1. Authenticate user
    const supabase = await createSupabaseServerAuth();
    const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
    if (!authorization.authorized) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Company information not found' },
        { status: authorization.status, headers: NO_STORE_HEADERS }
      );
    }

    // 2. Get user's profile to resolve company_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', authorization.profileId)
      .eq('company_id', authorization.companyId)
      .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Company information not found' },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    // 3. Generate daily briefing
    const briefingService = new DailyBriefingService(
      supabase,
      authorization.companyId,
      profile.full_name
    );

    const briefing = await briefingService.generateBriefing();

    // 4. Return briefing
    return NextResponse.json(briefing, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error('[Daily Briefing API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate daily briefing' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
