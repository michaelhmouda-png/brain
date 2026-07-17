/**
 * Announcements API - Get/Update/Delete by ID
 * GET /api/announcements/:id - Get announcement by ID
 * PUT /api/announcements/:id - Update announcement
 * DELETE /api/announcements/:id - Delete announcement
 */

import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { AnnouncementsService } from '@/lib/announcements';
import { ActivityTimelineService } from '@/lib/activity-timeline';
import { NextRequest, NextResponse } from 'next/server';

async function getCompanyId(supabase: any, user: any) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('user_id', user.id)
    .single();
  return profile?.company_id;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerAuth();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const companyId = await getCompanyId(supabase, user);
    if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 403 });

    const announcementsService = new AnnouncementsService(supabase, companyId);
    const announcement = await announcementsService.getAnnouncementById(id);

    if (!announcement) {
      return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });
    }

    return NextResponse.json(announcement);
  } catch (error) {
    console.error('[Announcements API] GET by ID error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerAuth();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const companyId = await getCompanyId(supabase, user);
    if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 403 });

    const announcementsService = new AnnouncementsService(supabase, companyId);
    const timelineService = new ActivityTimelineService(supabase, companyId);

    const body = await req.json();
    const { title, content, priority, expiresAt, targetRoles } = body;

    const updates: any = {};
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (priority !== undefined) updates.priority = priority;
    if (expiresAt !== undefined) updates.expires_at = expiresAt;
    if (targetRoles !== undefined) updates.target_roles = targetRoles;

    const announcement = await announcementsService.updateAnnouncement(id, updates);

    if (announcement) {
      await timelineService.logActivity(
        user.id,
        'announcement_updated',
        'announcement',
        announcement.id,
        `Announcement updated: ${title || 'No title change'}`
      );
    }

    return NextResponse.json(announcement);
  } catch (error) {
    console.error('[Announcements API] PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerAuth();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const companyId = await getCompanyId(supabase, user);
    if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 403 });

    const announcementsService = new AnnouncementsService(supabase, companyId);
    const timelineService = new ActivityTimelineService(supabase, companyId);

    const success = await announcementsService.deleteAnnouncement(id);

    if (success) {
      await timelineService.logActivity(
        user.id,
        'announcement_deleted',
        'announcement',
        id,
        'Announcement deleted'
      );
      return NextResponse.json({ success: true, message: 'Announcement deleted' });
    }

    return NextResponse.json({ error: 'Failed to delete announcement' }, { status: 400 });
  } catch (error) {
    console.error('[Announcements API] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
