/**
 * Shifts API - Get/Update/Delete by ID
 * GET /api/shifts/:id - Get shift by ID
 * PUT /api/shifts/:id - Update shift
 * DELETE /api/shifts/:id - Delete shift
 */

import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { ShiftManagementService } from '@/lib/shift-management';
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

    const shiftService = new ShiftManagementService(supabase, companyId);
    const shift = await shiftService.getShiftById(id);

    if (!shift) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    }

    return NextResponse.json(shift);
  } catch (error) {
    console.error('[Shifts API] GET by ID error:', error);
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

    const shiftService = new ShiftManagementService(supabase, companyId);
    const timelineService = new ActivityTimelineService(supabase, companyId);

    const body = await req.json();
    const { employeeId, shiftDate, startTime, endTime, shiftType, departmentId, notes, status } = body;

    const updates: any = {};
    if (employeeId !== undefined) updates.employee_id = employeeId;
    if (shiftDate !== undefined) updates.shift_date = shiftDate;
    if (startTime !== undefined) updates.start_time = startTime;
    if (endTime !== undefined) updates.end_time = endTime;
    if (shiftType !== undefined) updates.shift_type = shiftType;
    if (departmentId !== undefined) updates.department_id = departmentId;
    if (notes !== undefined) updates.notes = notes;
    if (status !== undefined) updates.status = status;

    const shift = await shiftService.updateShift(id, updates);

    if (shift) {
      await timelineService.logActivity(
        user.id,
        'shift_updated',
        'shift',
        shift.id,
        `Shift updated for ${shiftDate || 'date not specified'}`
      );
    }

    return NextResponse.json(shift);
  } catch (error) {
    console.error('[Shifts API] PUT error:', error);
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

    const shiftService = new ShiftManagementService(supabase, companyId);
    const timelineService = new ActivityTimelineService(supabase, companyId);

    const success = await shiftService.deleteShift(id);

    if (success) {
      await timelineService.logActivity(
        user.id,
        'shift_deleted',
        'shift',
        id,
        'Shift deleted'
      );
      return NextResponse.json({ success: true, message: 'Shift deleted' });
    }

    return NextResponse.json({ error: 'Failed to delete shift' }, { status: 400 });
  } catch (error) {
    console.error('[Shifts API] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
