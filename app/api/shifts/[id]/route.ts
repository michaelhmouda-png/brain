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
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerAuth();
    const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
    if (!authorization.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: authorization.status });
    if (authorization.role === 'employee' && !authorization.employeeId) return NextResponse.json({ error: 'Employee link required' }, { status: 409 });

    const shiftService = new ShiftManagementService(supabase, authorization.companyId);
    const shift = await shiftService.getShiftById(id);

    if (!shift || authorization.role === 'employee' && shift.employee_id !== authorization.employeeId) {
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
    const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
    if (!authorization.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: authorization.status });
    if (authorization.role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const shiftService = new ShiftManagementService(supabase, authorization.companyId);
    const timelineService = new ActivityTimelineService(supabase, authorization.companyId);

    const body: unknown = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
    const { employeeId, shiftDate, startTime, endTime, shiftType, departmentId, notes, status } = body as Record<string, unknown>;

    const updates: Record<string, unknown> = {};
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
        authorization.userId,
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
    const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
    if (!authorization.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: authorization.status });
    if (authorization.role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const shiftService = new ShiftManagementService(supabase, authorization.companyId);
    const timelineService = new ActivityTimelineService(supabase, authorization.companyId);

    const success = await shiftService.deleteShift(id);

    if (success) {
      await timelineService.logActivity(
        authorization.userId,
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
