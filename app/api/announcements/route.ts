/**
 * Announcements API
 * GET /api/announcements - List announcements with pagination, search, filtering
 * POST /api/announcements - Create announcement
 */

import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { AnnouncementsService } from '@/lib/announcements';
import { ActivityTimelineService } from '@/lib/activity-timeline';
import { NotificationsService } from '@/lib/notifications';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerAuth();
    const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
    if (!authorization.authorized) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'No company found' },
        { status: authorization.status }
      );
    }

    const announcementsService = new AnnouncementsService(supabase, authorization.companyId);

    const url = new URL(req.url);
    
    // Extract query parameters
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
    const search = url.searchParams.get('search') || undefined;
    const priority = url.searchParams.get('priority') || undefined;
    const includeExpired = url.searchParams.get('includeExpired') === 'true';
    const sortBy = url.searchParams.get('sortBy') || 'published_at';
    const sortOrder = (url.searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';

    // List with full pagination, search, and filtering
    const result = await announcementsService.listAnnouncements({
      page,
      pageSize,
      search,
      priority,
      includeExpired,
      sortBy: sortBy as 'published_at' | 'priority' | 'expires_at',
      sortOrder,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Announcements API] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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

    const announcementsService = new AnnouncementsService(supabase, profile.company_id);
    const timelineService = new ActivityTimelineService(supabase, profile.company_id);
    const notificationService = new NotificationsService(supabase, profile.company_id);

    const body = await req.json();
    const { action, data } = body;

    if (action === 'create') {
      const announcement = await announcementsService.createAnnouncement(
        data.title,
        data.content,
        data.priority || 'normal',
        user.id,
        data.expiresAt || null
      );

      await timelineService.logActivity(
        user.id,
        'announcement_published',
        'announcement',
        announcement.id,
        data.title
      );

      // Notify all employees in company
      const { data: employees } = await supabase
        .from('employees')
        .select('user_id')
        .eq('company_id', profile.company_id);

      if (employees) {
        const employeeUserIds = employees
          .map((e: any) => e.user_id)
          .filter((id: string) => id && id !== user.id);

        if (employeeUserIds.length > 0) {
          await notificationService.notifyMultiple(
            employeeUserIds,
            data.title,
            data.content.substring(0, 100),
            'announcement',
            'announcement',
            announcement.id
          );
        }
      }

      return NextResponse.json(announcement);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[Announcements API] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
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

    const announcementsService = new AnnouncementsService(supabase, profile.company_id);
    const timelineService = new ActivityTimelineService(supabase, profile.company_id);

    const body = await req.json();
    const { action, data } = body;

    if (action === 'acknowledge') {
      await announcementsService.acknowledgeAnnouncement(data.announcementId, data.employeeId);

      await timelineService.logActivity(
        user.id,
        'announcement_acknowledged',
        'announcement',
        data.announcementId,
        `Employee acknowledged announcement`
      );

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[Announcements API] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
