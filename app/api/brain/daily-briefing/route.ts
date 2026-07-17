import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { DailyBriefingService } from '@/lib/dailyBriefingService';

export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate user
    const supabase = await createSupabaseServerAuth();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Get user's profile to resolve company_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, company_id, full_name')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || !profile.company_id) {
      return NextResponse.json(
        { error: 'Company information not found' },
        { status: 403 }
      );
    }

    // 3. Generate daily briefing
    const briefingService = new DailyBriefingService(
      supabase,
      profile.company_id,
      profile.full_name
    );

    const briefing = await briefingService.generateBriefing();

    // 4. Return briefing
    return NextResponse.json(briefing, {
      headers: {
        'Cache-Control': 'private, max-age=300', // Cache for 5 minutes
      },
    });
  } catch (error) {
    console.error('[Daily Briefing API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate daily briefing' },
      { status: 500 }
    );
  }
}
