import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const supabase = await createSupabaseServerAuth();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    // Get user's company_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: 'User profile not found' },
        { status: 403 }
      );
    }

    // Get recent timeline events (last 10)
    const { data: events, error } = await supabase
      .from('business_events')
      .select('*')
      .eq('company_id', profile.company_id)
      .order('occurred_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Failed to fetch timeline:', error);
      return NextResponse.json(
        { error: 'Failed to fetch timeline' },
        { status: 500 }
      );
    }

    // Cache for 1 minute
    return NextResponse.json(
      { events: events || [] },
      {
        headers: {
          'Cache-Control': 'private, max-age=60',
        },
      }
    );
  } catch (err) {
    console.error('Timeline API error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
