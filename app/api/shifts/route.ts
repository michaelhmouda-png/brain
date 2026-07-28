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
    if (authorization.role === 'employee' && !authorization.employeeId) return NextResponse.json({ error: 'Employee link required' }, { status: 409 });
    const employeeId = authorization.role === 'employee' ? authorization.employeeId! : url.searchParams.get('employeeId') || undefined;
    const sortBy = url.searchParams.get('sortBy') || 'shift_date';
    const sortOrder = (url.searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';
    const dateFrom = url.searchParams.get('dateFrom') || undefined;
    const dateTo = url.searchParams.get('dateTo') || undefined;

    const weekStart = url.searchParams.get('weekStart');

    if (type === 'schedules' && weekStart) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
        return NextResponse.json({ error: 'Invalid week' }, { status: 400 });
      }
      let scheduleQuery = supabase
        .from('weekly_schedules')
        .select('id,employee_id,week_start_date,monday_shift_id,tuesday_shift_id,wednesday_shift_id,thursday_shift_id,friday_shift_id,saturday_shift_id,sunday_shift_id')
        .eq('company_id', authorization.companyId)
        .eq('week_start_date', weekStart);
      if (employeeId) scheduleQuery = scheduleQuery.eq('employee_id', employeeId);
      const { data: scheduleRows, error: scheduleError } = await scheduleQuery;
      if (scheduleError) throw new Error('SCHEDULE_QUERY_FAILED');

      const shiftIdKeys = [
        'monday_shift_id', 'tuesday_shift_id', 'wednesday_shift_id', 'thursday_shift_id',
        'friday_shift_id', 'saturday_shift_id', 'sunday_shift_id',
      ] as const;
      const templateIds = [...new Set((scheduleRows ?? []).flatMap((row) =>
        shiftIdKeys.map((key) => row[key]).filter((value): value is string => typeof value === 'string')
      ))];
      const { data: templates, error: templateError } = templateIds.length
        ? await supabase.from('shift_templates').select('id,name,start_time,end_time').eq('company_id', authorization.companyId).in('id', templateIds)
        : { data: [], error: null };
      if (templateError) throw new Error('SCHEDULE_TEMPLATE_QUERY_FAILED');
      const templateById = new Map((templates ?? []).map((template) => [template.id, template]));

      const employeeIds = authorization.role === 'employee'
        ? []
        : [...new Set((scheduleRows ?? []).map((row) => row.employee_id))];
      const { data: employees, error: employeeError } = employeeIds.length
        ? await supabase.from('employees').select('id,first_name,last_name').eq('company_id', authorization.companyId).eq('status', 'active').in('id', employeeIds)
        : { data: [], error: null };
      if (employeeError) throw new Error('SCHEDULE_EMPLOYEE_QUERY_FAILED');
      const employeeById = new Map((employees ?? []).map((employee) => [employee.id, employee]));
      const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
      const schedules = (scheduleRows ?? []).map((row) => ({
        id: row.id,
        employee_id: row.employee_id,
        week_start_date: row.week_start_date,
        employee: authorization.role === 'employee' ? undefined : employeeById.get(row.employee_id) ?? null,
        days: Object.fromEntries(dayNames.map((day) => {
          const template = templateById.get(row[`${day}_shift_id` as (typeof shiftIdKeys)[number]] ?? '');
          return [day, template ? { name: template.name, startTime: template.start_time, endTime: template.end_time } : null];
        })),
      }));
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('timezone')
        .eq('id', authorization.companyId)
        .maybeSingle();
      if (companyError || typeof company?.timezone !== 'string' || !company.timezone) {
        throw new Error('SCHEDULE_TIMEZONE_QUERY_FAILED');
      }
      try {
        new Intl.DateTimeFormat('en', { timeZone: company.timezone }).format();
      } catch {
        throw new Error('SCHEDULE_TIMEZONE_QUERY_FAILED');
      }
      let stats = null;
      if (authorization.role !== 'employee') {
        const [{ count: swapsPending, error: swapsError }, { count: timeOffRequests, error: timeOffError }] = await Promise.all([
          supabase.from('shift_swaps').select('id', { count: 'exact', head: true }).eq('company_id', authorization.companyId).eq('status', 'pending'),
          supabase.from('time_off_requests').select('id', { count: 'exact', head: true }).eq('company_id', authorization.companyId).eq('status', 'pending'),
        ]);
        if (swapsError || timeOffError) throw new Error('SCHEDULE_STATS_QUERY_FAILED');
        stats = {
          employeesScheduled: schedules.length,
          swapsPending: swapsPending ?? 0,
          timeOffRequests: timeOffRequests ?? 0,
        };
      }
      return NextResponse.json({
        scope: authorization.role === 'employee' ? 'personal' : 'management',
        timezone: company.timezone,
        schedules,
        stats,
      });
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
      if (authorization.role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
    const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
    if (!authorization.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: authorization.status });
    if (authorization.role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const shiftService = new ShiftManagementService(supabase, authorization.companyId);
    const timelineService = new ActivityTimelineService(supabase, authorization.companyId);

    const body = await req.json();
    const { action, data } = body;

    if (action === 'create_schedule') {
      const schedule = await shiftService.upsertWeeklySchedule(
        data.employeeId,
        data.weekStartDate,
        data.schedule,
        authorization.userId
      );

      await timelineService.logActivity(
        authorization.userId,
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
        authorization.userId
      );

      await timelineService.logActivity(
        authorization.userId,
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
        authorization.userId,
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
        authorization.userId,
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
        authorization.userId,
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
        authorization.userId,
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
        authorization.userId,
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
    const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
    if (!authorization.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: authorization.status });
    if (authorization.role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const shiftService = new ShiftManagementService(supabase, authorization.companyId);
    const timelineService = new ActivityTimelineService(supabase, authorization.companyId);

    const body = await req.json();
    const { action, data } = body;

    if (action === 'approve_swap') {
      const swap = await shiftService.approveShiftSwap(data.swapId, authorization.userId);

      await timelineService.logActivity(
        authorization.userId,
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
        authorization.userId
      );

      await timelineService.logActivity(
        authorization.userId,
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
