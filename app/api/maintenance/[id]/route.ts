/**
 * Maintenance API - Get/Update/Delete by ID
 * GET /api/maintenance/:id - Get ticket by ID
 * PUT /api/maintenance/:id - Update ticket
 * DELETE /api/maintenance/:id - Delete ticket
 */

import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { MaintenanceService } from '@/lib/maintenance';
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

    const maintenanceService = new MaintenanceService(supabase, companyId);
    const ticket = await maintenanceService.getTicketById(id);

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    return NextResponse.json(ticket);
  } catch (error) {
    console.error('[Maintenance API] GET by ID error:', error);
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

    const maintenanceService = new MaintenanceService(supabase, companyId);
    const timelineService = new ActivityTimelineService(supabase, companyId);

    const body = await req.json();
    const { title, description, priority, locationId, assignedToId, dueDate, status, completionNotes } = body;

    const updates: any = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (priority !== undefined) updates.priority = priority;
    if (locationId !== undefined) updates.location_id = locationId;
    if (assignedToId !== undefined) updates.assigned_to_id = assignedToId;
    if (dueDate !== undefined) updates.due_date = dueDate;
    if (status !== undefined) updates.status = status;
    if (completionNotes !== undefined) updates.completion_notes = completionNotes;

    const ticket = await maintenanceService.updateTicket(id, updates);

    if (ticket) {
      await timelineService.logActivity(
        user.id,
        'maintenance_ticket_updated',
        'maintenance_ticket',
        ticket.id,
        `Ticket updated: ${title || 'No title change'}`
      );
    }

    return NextResponse.json(ticket);
  } catch (error) {
    console.error('[Maintenance API] PUT error:', error);
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

    const maintenanceService = new MaintenanceService(supabase, companyId);
    const timelineService = new ActivityTimelineService(supabase, companyId);

    const success = await maintenanceService.deleteTicket(id);

    if (success) {
      await timelineService.logActivity(
        user.id,
        'maintenance_ticket_deleted',
        'maintenance_ticket',
        id,
        'Ticket deleted'
      );
      return NextResponse.json({ success: true, message: 'Ticket deleted' });
    }

    return NextResponse.json({ error: 'Failed to delete ticket' }, { status: 400 });
  } catch (error) {
    console.error('[Maintenance API] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
