/**
 * Shift Management API
 * GET /api/shifts - List shifts with pagination, search, filtering
 * POST /api/shifts - Create shift
 */

import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { ShiftManagementService } from '@/lib/shift-management';
import { ActivityTimelineService } from '@/lib/activity-timeline';
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

    const shiftService = new ShiftManagementService(supabase, authorization.companyId);

    // Query params
    const url = new URL(req.url);
    const type = url.searchParams.get('type'); // 'list', 'schedules', 'recurring', 'attendance', 'templates'
    
    // List shifts specific parameters
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
    const search = url.searchParams.get('search') || undefined;
    const status = url.searchParams.get('status') || undefined;
    const shiftType = url.searchParams.get('shiftType') || undefined;
    const employeeId = url.searchParams.get('employeeId') || undefined;
    const sortBy = url.searchParams.get('sortBy') || 'shift_date';
    const sortOrder = (url.searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';
    const dateFrom = url.searchParams.get('dateFrom') || undefined;
    const dateTo = url.searchParams.get('dateTo') || undefined;

    const weekStart = url.searchParams.get('weekStart');

    if (type === 'schedules' && weekStart) {
      let schedules;
      if (employeeId) {
        schedules = await shiftService.getWeeklySchedule(employeeId, weekStart);
      } else {
        // For company-wide view, fetch all active employees' schedules
        const { data: employees } = await supabase
          .from('employees')
          .select('id')
          .eq('company_id', authorization.companyId)
          .eq('status', 'active');
        
        schedules = [];
        for (const emp of employees || []) {
          const empSchedules = await shiftService.getWeeklySchedule(emp.id, weekStart);
          if (empSchedules) schedules.push(empSchedules);
        }
      }
      return NextResponse.json(Array.isArray(schedules) ? schedules : [schedules]);
    }

    if (type === 'recurring') {
      const recurring = await shiftService.getRecurringShifts(employeeId || undefined);
      return NextResponse.json(recurring);
    }

    if (type === 'attendance' && employeeId && weekStart) {
      // weekStart should be in format for date range
      const startDate = weekStart;
      const endDate = new Date(weekStart);
      endDate.setDate(endDate.getDate() + 6);
      const endDateStr = endDate.toISOString().split('T')[0];
      const attendance = await shiftService.getAttendanceRecords(employeeId, startDate, endDateStr);
      return NextResponse.json(attendance);
    }

    if (type === 'templates') {
      const templates = await shiftService.getShiftTemplates();
      return NextResponse.json(templates);
    }

    // Default: list shifts with pagination, search, filtering
    const result = await shiftService.listShifts({
      page,
      pageSize,
      search,
      status,
      shiftType,
      employeeId,
      sortBy: sortBy as 'shift_date' | 'created_at' | 'status',
      sortOrder,
      dateFrom,
      dateTo,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Shifts API] GET error:', error);
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

    const shiftService = new ShiftManagementService(supabase, profile.company_id);
    const timelineService = new ActivityTimelineService(supabase, profile.company_id);

    const body = await req.json();
    const { action, data } = body;

    if (action === 'create_schedule') {
      const schedule = await shiftService.upsertWeeklySchedule(
        data.employeeId,
        data.weekStartDate,
        data.schedule,
        user.id
      );

      await timelineService.logActivity(
        user.id,
        'schedule_created',
        'schedule',
        schedule.id,
        `Schedule for week of ${data.weekStartDate}`
      );

      return NextResponse.json(schedule);
    }

    if (action === 'create_recurring_shift') {
      const shift = await shiftService.createRecurringShift(
        data.employeeId,
        data.shiftTemplateId,
        data.dayOfWeek,
        data.startDate,
        data.endDate || null,
        user.id
      );

      await timelineService.logActivity(
        user.id,
        'recurring_shift_created',
        'recurring_shift',
        shift.id,
        `Recurring shift for employee`
      );

      return NextResponse.json(shift);
    }

    if (action === 'clock_in') {
      const record = await shiftService.clockIn(
        data.employeeId,
        data.shiftDate,
        data.location
      );

      await timelineService.logActivity(
        user.id,
        'clock_in',
        'attendance',
        record.id,
        `Employee clocked in`,
        { location: data.location }
      );

      return NextResponse.json(record);
    }

    if (action === 'clock_out') {
      const record = await shiftService.clockOut(
        data.employeeId,
        data.shiftDate,
        data.notes
      );

      await timelineService.logActivity(
        user.id,
        'clock_out',
        'attendance',
        record.id,
        `Employee clocked out`
      );

      return NextResponse.json(record);
    }

    if (action === 'swap_request') {
      const swap = await shiftService.createShiftSwapRequest(
        data.requestorId,
        data.targetEmployeeId,
        data.requestorShiftDate,
        data.targetShiftDate,
        data.notes
      );

      await timelineService.logActivity(
        user.id,
        'shift_swap_requested',
        'shift_swap',
        swap.id,
        `Shift swap request created`
      );

      return NextResponse.json(swap);
    }

    if (action === 'time_off_request') {
      const request = await shiftService.createTimeOffRequest(
        data.employeeId,
        data.startDate,
        data.endDate,
        data.reason
      );

      await timelineService.logActivity(
        user.id,
        'time_off_requested',
        'time_off_request',
        request.id,
        `Time off request from ${data.startDate} to ${data.endDate}`
      );

      return NextResponse.json(request);
    }

    if (action === 'create_template') {
      const template = await shiftService.createShiftTemplate(
        data.name,
        data.startTime,
        data.endTime,
        data.departmentId || null,
        data.breakMinutes || 0
      );

      await timelineService.logActivity(
        user.id,
        'shift_template_created',
        'shift_template',
        template.id,
        data.name
      );

      return NextResponse.json(template);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[Shifts API] POST error:', error);
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

    const shiftService = new ShiftManagementService(supabase, profile.company_id);
    const timelineService = new ActivityTimelineService(supabase, profile.company_id);

    const body = await req.json();
    const { action, data } = body;

    if (action === 'approve_swap') {
      const swap = await shiftService.approveShiftSwap(data.swapId, user.id);

      await timelineService.logActivity(
        user.id,
        'shift_swap_approved',
        'shift_swap',
        swap.id,
        `Shift swap approved`
      );

      return NextResponse.json(swap);
    }

    if (action === 'approve_time_off') {
      const timeOff = await shiftService.approveTimeOffRequest(
        data.requestId,
        user.id
      );

      await timelineService.logActivity(
        user.id,
        'time_off_approved',
        'time_off_request',
        timeOff.id,
        `Time off request approved`
      );

      return NextResponse.json(timeOff);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[Shifts API] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
