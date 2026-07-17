/**
 * Notifications API
 * GET /api/notifications - Get notifications
 * PATCH /api/notifications/:id - Update notification
 */

import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { NotificationsService } from '@/lib/notifications';
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

    const notificationService = new NotificationsService(supabase, profile.company_id);

    const url = new URL(req.url);
    const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
    const count = url.searchParams.get('count') === 'true';

    if (count) {
      const unreadCount = await notificationService.getUnreadCount(user.id);
      return NextResponse.json({ unreadCount });
    }

    const notifications = await notificationService.getNotifications(user.id, unreadOnly);
    return NextResponse.json(notifications);
  } catch (error) {
    console.error('[Notifications API] GET error:', error);
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

    const notificationService = new NotificationsService(supabase, profile.company_id);

    const body = await req.json();
    const { action, data } = body;

    if (action === 'mark_read') {
      const notification = await notificationService.markAsRead(data.notificationId);
      return NextResponse.json(notification);
    }

    if (action === 'mark_all_read') {
      const success = await notificationService.markAllAsRead(user.id);
      return NextResponse.json({ success });
    }

    if (action === 'delete') {
      const success = await notificationService.deleteNotification(data.notificationId);
      return NextResponse.json({ success });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[Notifications API] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
