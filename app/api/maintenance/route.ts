/**
 * Maintenance API
 * GET /api/maintenance - List tickets with pagination, search, filtering
 * POST /api/maintenance - Create ticket
 */

import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { MaintenanceService } from '@/lib/maintenance';
import { ActivityTimelineService } from '@/lib/activity-timeline';
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

    const maintenanceService = new MaintenanceService(supabase, profile.company_id);

    const url = new URL(req.url);
    
    // Extract query parameters
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
    const search = url.searchParams.get('search') || undefined;
    const status = url.searchParams.get('status') || undefined;
    const priority = url.searchParams.get('priority') || undefined;
    const assignedToId = url.searchParams.get('assignedToId') || undefined;
    const sortBy = url.searchParams.get('sortBy') || 'created_at';
    const sortOrder = (url.searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';
    const dueDateFrom = url.searchParams.get('dueDateFrom') || undefined;
    const dueDateTo = url.searchParams.get('dueDateTo') || undefined;
    const overdue = url.searchParams.get('overdue');

    // Handle overdue tickets special case
    if (overdue === 'true') {
      const tickets = await maintenanceService.getOverdueTickets();
      return NextResponse.json({ data: tickets, total: tickets.length });
    }

    // List with full pagination, search, and filtering
    const result = await maintenanceService.listTickets({
      page,
      pageSize,
      search,
      status,
      priority,
      assignedToId,
      sortBy: sortBy as any,
      sortOrder,
      dueDateFrom,
      dueDateTo,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Maintenance API] GET error:', error);
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

    const maintenanceService = new MaintenanceService(supabase, profile.company_id);
    const timelineService = new ActivityTimelineService(supabase, profile.company_id);
    const notificationService = new NotificationsService(supabase, profile.company_id);

    const body = await req.json();
    const { action, data } = body;

    if (action === 'create_ticket') {
      const ticket = await maintenanceService.createTicket(
        data.title,
        data.description,
        data.priority || 'medium',
        data.locationId || null,
        data.assignedToId || null,
        data.dueDate || null,
        user.id
      );

      await timelineService.logActivity(
        user.id,
        'maintenance_ticket_created',
        'maintenance_ticket',
        ticket.id,
        data.title
      );

      // Notify if assigned
      if (data.assignedToId) {
        await notificationService.createNotification(
          data.assignedToId,
          'New Maintenance Ticket',
          `You've been assigned: ${data.title}`,
          'maintenance',
          'maintenance_ticket',
          ticket.id
        );
      }

      return NextResponse.json(ticket);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[Maintenance API] POST error:', error);
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

    const maintenanceService = new MaintenanceService(supabase, profile.company_id);
    const timelineService = new ActivityTimelineService(supabase, profile.company_id);

    const body = await req.json();
    const { action, data } = body;

    if (action === 'update_status') {
      const ticket = await maintenanceService.updateTicketStatus(
        data.ticketId,
        data.status,
        data.completionNotes || undefined
      );

      await timelineService.logActivity(
        user.id,
        'maintenance_ticket_updated',
        'maintenance_ticket',
        ticket.id,
        `Status changed to ${data.status}`
      );

      return NextResponse.json(ticket);
    }

    if (action === 'assign') {
      const ticket = await maintenanceService.assignTicket(
        data.ticketId,
        data.assignedToId
      );

      await timelineService.logActivity(
        user.id,
        'maintenance_ticket_assigned',
        'maintenance_ticket',
        ticket.id,
        `Assigned to employee`
      );

      return NextResponse.json(ticket);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[Maintenance API] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
