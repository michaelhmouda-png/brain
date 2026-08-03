/**
 * Shift Management API
 * GET /api/shifts - List shifts with pagination, search, filtering
 * POST /api/shifts - Create shift
 */

import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';
import { ShiftManagementService } from '@/lib/shift-management';
import { ActivityTimelineService } from '@/lib/activity-timeline';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { canManageShifts } from '@/lib/shifts/contracts';
import { createConcreteShift, normalizeShiftCreationError } from '@/lib/shifts/service.server';
import { confirmWeeklyShiftSchedule, manageWeeklyShiftSchedules, normalizeWeeklyShiftError, previewWeeklyShiftSchedule } from '@/lib/shifts/weekly.server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };

function addCalendarDays(date: string, days: number) {
  const instant = new Date(`${date}T12:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

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
    const locationId = url.searchParams.get('locationId') || undefined;
    const departmentId = url.searchParams.get('departmentId') || undefined;

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

      const { data: employees, error: employeeError } = authorization.role === 'employee'
        ? { data: [], error: null }
        : await supabase.from('employees')
          .select('id,first_name,last_name,location_id,department_id,department:departments!employees_department_id_fkey(id,name)')
          .eq('company_id', authorization.companyId)
          .eq('status', 'active')
          .order('first_name');
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
      let concreteQuery = supabase
        .from('shifts')
        .select('id,employee_id,location_id,shift_date,start_time,end_time,status')
        .eq('company_id', authorization.companyId)
        .eq('status', status || 'scheduled')
        .gte('shift_date', weekStart)
        .lte('shift_date', addCalendarDays(weekStart, 6))
        .order('shift_date')
        .order('start_time');
      if (employeeId) concreteQuery = concreteQuery.eq('employee_id', employeeId);
      if (locationId) concreteQuery = concreteQuery.eq('location_id', locationId);
      if (departmentId && authorization.role !== 'employee') {
        const matchingEmployeeIds = (employees ?? []).filter((employee) => employee.department_id === departmentId).map((employee) => employee.id);
        concreteQuery = matchingEmployeeIds.length ? concreteQuery.in('employee_id', matchingEmployeeIds) : concreteQuery.in('employee_id', ['00000000-0000-0000-0000-000000000000']);
      }
      const { data: concreteRows, error: concreteError } = await concreteQuery;
      if (concreteError) throw new Error('SCHEDULE_CONCRETE_QUERY_FAILED');

      const { data: locations, error: locationError } = authorization.role === 'employee'
        ? { data: [], error: null }
        : await supabase.from('locations')
          .select('id,name,timezone')
          .eq('company_id', authorization.companyId)
          .eq('status', 'active')
          .order('name');
      if (locationError) throw new Error('SCHEDULE_LOCATION_QUERY_FAILED');

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
      let weeklySeries: unknown[] = [];
      if (authorization.role !== 'employee') {
        let seriesQuery = supabase.from('weekly_shift_schedule_series')
          .select('id,employee_id,location_id,status,current_version,weekly_shift_schedule_versions(version,weekdays,start_time,end_time,effective_from,effective_until)')
          .eq('company_id', authorization.companyId).order('created_at', { ascending: false });
        if (employeeId) seriesQuery = seriesQuery.eq('employee_id', employeeId);
        if (locationId) seriesQuery = seriesQuery.eq('location_id', locationId);
        const { data: seriesRows, error: seriesError } = await seriesQuery;
        if (seriesError) throw new Error('WEEKLY_SERIES_QUERY_FAILED');
        weeklySeries = (seriesRows ?? []).filter((series) => {
          const employee = (employees ?? []).find((row) => row.id === series.employee_id);
          return !departmentId || employee?.department_id === departmentId;
        });
        const [{ count: swapsPending, error: swapsError }, { count: timeOffRequests, error: timeOffError }] = await Promise.all([
          supabase.from('shift_swaps').select('id', { count: 'exact', head: true }).eq('company_id', authorization.companyId).eq('status', 'pending'),
          supabase.from('time_off_requests').select('id', { count: 'exact', head: true }).eq('company_id', authorization.companyId).eq('status', 'pending'),
        ]);
        if (swapsError || timeOffError) throw new Error('SCHEDULE_STATS_QUERY_FAILED');
        stats = {
          employeesScheduled: new Set([
            ...schedules.map((schedule) => schedule.employee_id),
            ...(concreteRows ?? []).map((shift) => shift.employee_id),
          ]).size,
          swapsPending: swapsPending ?? 0,
          timeOffRequests: timeOffRequests ?? 0,
        };
      }
      return NextResponse.json({
        scope: authorization.role === 'employee' ? 'personal' : 'management',
        timezone: company.timezone,
        schedules,
        concreteShifts: (concreteRows ?? []).map((shift) => ({
          id: shift.id,
          employeeId: shift.employee_id,
          locationId: shift.location_id,
          date: shift.shift_date,
          startTime: String(shift.start_time).slice(0, 5),
          endTime: String(shift.end_time).slice(0, 5),
          status: shift.status,
        })),
        ...(authorization.role === 'employee' ? {} : {
          employees: (employees ?? []).map((employee) => ({
            id: employee.id,
            firstName: employee.first_name,
            lastName: employee.last_name,
            locationId: employee.location_id,
            departmentId: employee.department_id,
            departmentName: Array.isArray(employee.department) ? employee.department[0]?.name ?? null : null,
          })),
          locations: locations ?? [],
        }),
        stats,
        ...(authorization.role === 'employee' ? {} : { weeklySeries }),
      }, { headers: NO_STORE });
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
    const actor = await resolveActorContext(supabase);
    if (!canManageShifts(actor.role)) {
      return NextResponse.json({ error: 'SHIFT_FORBIDDEN' }, { status: 403, headers: NO_STORE });
    }

    const shiftService = new ShiftManagementService(supabase, actor.companyId);
    const timelineService = new ActivityTimelineService(supabase, actor.companyId);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'SHIFT_INPUT_INVALID' }, { status: 400, headers: NO_STORE });
    }
    const { action, data } = body;

    if (action === 'create_shift') {
      const shift = await createConcreteShift(supabase, createSupabaseServer(), actor, data);
      return NextResponse.json({ data: shift }, { status: 201, headers: NO_STORE });
    }

    if (action === 'preview_weekly_schedule') {
      const preview = await previewWeeklyShiftSchedule(createSupabaseServer(), actor, data);
      return NextResponse.json({ data: preview }, { headers: NO_STORE });
    }

    if (action === 'confirm_weekly_schedule') {
      const result = await confirmWeeklyShiftSchedule(createSupabaseServer(), actor, data, body.previewToken);
      return NextResponse.json({ data: result }, { status: 201, headers: NO_STORE });
    }

    if (action === 'manage_weekly_schedule') {
      const result = await manageWeeklyShiftSchedules(createSupabaseServer(), actor, data?.scheduleAction, data?.seriesIds, data?.input ?? {});
      return NextResponse.json({ data: result }, { headers: NO_STORE });
    }

    if (action === 'create_schedule') {
      const schedule = await shiftService.upsertWeeklySchedule(
        data.employeeId,
        data.weekStartDate,
        data.schedule,
        actor.profileId
      );

      await timelineService.logActivity(
        actor.profileId,
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
        actor.profileId
      );

      await timelineService.logActivity(
        actor.profileId,
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
        actor.profileId,
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
        actor.profileId,
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
        actor.profileId,
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
        actor.profileId,
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
        actor.profileId,
        'shift_template_created',
        'shift_template',
        template.id,
        data.name
      );

      return NextResponse.json(template);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400, headers: NO_STORE });
  } catch (error) {
    if (error instanceof ActorContextError) {
      return NextResponse.json(
        { error: error.code },
        { status: error.code === 'UNAUTHENTICATED' ? 401 : 403, headers: NO_STORE },
      );
    }
    const weeklyCode = normalizeWeeklyShiftError(error);
    if (weeklyCode !== 'WEEKLY_SHIFT_UNAVAILABLE') {
      const status = weeklyCode === 'WEEKLY_SHIFT_FORBIDDEN' ? 403
        : weeklyCode === 'WEEKLY_SHIFT_CONFLICT' || weeklyCode === 'WEEKLY_SHIFT_DUPLICATE' || weeklyCode === 'WEEKLY_SHIFT_STALE_PREVIEW' ? 409 : 400;
      return NextResponse.json({ error: weeklyCode }, { status, headers: NO_STORE });
    }
    const code = normalizeShiftCreationError(error);
    if (code !== 'SHIFT_UNAVAILABLE') {
      const status = code === 'SHIFT_FORBIDDEN' ? 403
        : code === 'SHIFT_DUPLICATE' || code === 'SHIFT_CONFLICT' ? 409 : 400;
      return NextResponse.json({ error: code }, { status, headers: NO_STORE });
    }
    console.error('[Shifts API] POST unavailable');
    return NextResponse.json({ error: 'SHIFT_UNAVAILABLE' }, { status: 503, headers: NO_STORE });
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
