/**
 * Activity Timeline API
 * GET /api/activity - Get activity
 */

import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { ActivityTimelineService } from '@/lib/activity-timeline';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerAuth();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('user_id', user.id)
      .single();

    if (!profile?.company_id) {
      return NextResponse.json({ error: 'No company found' }, { status: 403 });
    }

    const activityService = new ActivityTimelineService(supabase, profile.company_id);

    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const entityType = url.searchParams.get('entityType');
    const entityId = url.searchParams.get('entityId');
    const actionType = url.searchParams.get('actionType');
    const days = url.searchParams.get('days');

    if (entityType && entityId) {
      const activity = await activityService.getActivityForEntity(entityType, entityId);
      return NextResponse.json(activity);
    }

    if (actionType) {
      const activity = await activityService.getActivityByType(actionType, limit);
      return NextResponse.json(activity);
    }

    if (days) {
      const activity = await activityService.getRecentActivity(parseInt(days));
      return NextResponse.json(activity);
    }

    const activity = await activityService.getActivityTimeline(limit, offset);
    return NextResponse.json(activity);
  } catch (error) {
    console.error('[Activity API] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
