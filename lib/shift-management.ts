/**
 * Shift Management Service
 * Handles all shift-related database operations with RLS enforcement
 */

import { SupabaseClient } from '@supabase/supabase-js';

export class ShiftManagementService {
  constructor(
    private supabase: SupabaseClient,
    private companyId: string
  ) {}

  // ──────────────────────────────────────────────────────────────
  // Weekly Schedules
  // ──────────────────────────────────────────────────────────────

  async getWeeklySchedule(employeeId: string, weekStartDate: string) {
    const { data, error } = await this.supabase
      .from('weekly_schedules')
      .select('*')
      .eq('company_id', this.companyId)
      .eq('employee_id', employeeId)
      .eq('week_start_date', weekStartDate)
      .maybeSingle();

    if (error) console.error('[Shift Service] Get weekly schedule error:', error.message);
    return data;
  }

  async getScheduleForWeek(weekStartDate: string, departmentId?: string) {
    let query = this.supabase
      .from('weekly_schedules')
      .select('*, employee:employees(id, first_name, last_name), shift_templates:shift_templates(*)')
      .eq('company_id', this.companyId)
      .eq('week_start_date', weekStartDate);

    if (departmentId) {
      query = query.eq('employee.department_id', departmentId);
    }

    const { data, error } = await query;
    if (error) console.error('[Shift Service] Get schedule for week error:', error.message);
    return data || [];
  }

  async upsertWeeklySchedule(
    employeeId: string,
    weekStartDate: string,
    schedule: any,
    createdByUserId: string
  ) {
    const { data, error } = await this.supabase
      .from('weekly_schedules')
      .upsert({
        company_id: this.companyId,
        employee_id: employeeId,
        week_start_date: weekStartDate,
        ...schedule,
        created_by: createdByUserId,
      })
      .select()
      .single();

    if (error) console.error('[Shift Service] Upsert weekly schedule error:', error.message);
    return data;
  }

  // ──────────────────────────────────────────────────────────────
  // Recurring Shifts
  // ──────────────────────────────────────────────────────────────

  async getRecurringShifts(employeeId?: string) {
    let query = this.supabase
      .from('recurring_shifts')
      .select('*, employee:employees(first_name, last_name), template:shift_templates(*)')
      .eq('company_id', this.companyId);

    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }

    const { data, error } = await query;
    if (error) console.error('[Shift Service] Get recurring shifts error:', error.message);
    return data || [];
  }

  async createRecurringShift(
    employeeId: string,
    shiftTemplateId: string,
    dayOfWeek: number,
    startDate: string,
    endDate: string | null,
    createdByUserId: string
  ) {
    const { data, error } = await this.supabase
      .from('recurring_shifts')
      .insert({
        company_id: this.companyId,
        employee_id: employeeId,
        shift_template_id: shiftTemplateId,
        day_of_week: dayOfWeek,
        start_date: startDate,
        end_date: endDate,
        created_by: createdByUserId,
      })
      .select()
      .single();

    if (error) console.error('[Shift Service] Create recurring shift error:', error.message);
    return data;
  }

  // ──────────────────────────────────────────────────────────────
  // Attendance
  // ──────────────────────────────────────────────────────────────

  async clockIn(employeeId: string, shiftDate: string, location: string) {
    const { data, error } = await this.supabase
      .from('attendance_records')
      .insert({
        company_id: this.companyId,
        employee_id: employeeId,
        shift_date: shiftDate,
        clock_in_time: new Date().toISOString(),
        location,
      })
      .select()
      .single();

    if (error) console.error('[Shift Service] Clock in error:', error.message);
    return data;
  }

  async clockOut(employeeId: string, shiftDate: string, notes?: string) {
    const { data: record, error: getError } = await this.supabase
      .from('attendance_records')
      .select('id')
      .eq('company_id', this.companyId)
      .eq('employee_id', employeeId)
      .eq('shift_date', shiftDate)
      .is('clock_out_time', null)
      .maybeSingle();

    if (getError || !record) {
      console.error('[Shift Service] Clock out error: No active clock in found');
      return null;
    }

    const { data, error } = await this.supabase
      .from('attendance_records')
      .update({
        clock_out_time: new Date().toISOString(),
        notes,
      })
      .eq('id', record.id)
      .select()
      .single();

    if (error) console.error('[Shift Service] Clock out error:', error.message);
    return data;
  }

  async getAttendanceRecords(employeeId: string, startDate: string, endDate: string) {
    const { data, error } = await this.supabase
      .from('attendance_records')
      .select('*')
      .eq('company_id', this.companyId)
      .eq('employee_id', employeeId)
      .gte('shift_date', startDate)
      .lte('shift_date', endDate)
      .order('shift_date', { ascending: false });

    if (error) console.error('[Shift Service] Get attendance records error:', error.message);
    return data || [];
  }

  // ──────────────────────────────────────────────────────────────
  // Shift Swaps
  // ──────────────────────────────────────────────────────────────

  async createShiftSwapRequest(
    requestorId: string,
    targetEmployeeId: string,
    requestorShiftDate: string,
    targetShiftDate: string,
    notes?: string
  ) {
    const { data, error } = await this.supabase
      .from('shift_swaps')
      .insert({
        company_id: this.companyId,
        requestor_id: requestorId,
        target_employee_id: targetEmployeeId,
        requestor_shift_date: requestorShiftDate,
        target_shift_date: targetShiftDate,
        notes,
      })
      .select()
      .single();

    if (error) console.error('[Shift Service] Create shift swap error:', error.message);
    return data;
  }

  async approveShiftSwap(swapId: string, approvedByUserId: string) {
    const { data, error } = await this.supabase
      .from('shift_swaps')
      .update({
        status: 'approved',
        approved_by_id: approvedByUserId,
      })
      .eq('id', swapId)
      .eq('company_id', this.companyId)
      .select()
      .single();

    if (error) console.error('[Shift Service] Approve shift swap error:', error.message);
    return data;
  }

  // ──────────────────────────────────────────────────────────────
  // Time Off Requests
  // ──────────────────────────────────────────────────────────────

  async createTimeOffRequest(
    employeeId: string,
    startDate: string,
    endDate: string,
    reason?: string
  ) {
    const { data, error } = await this.supabase
      .from('time_off_requests')
      .insert({
        company_id: this.companyId,
        employee_id: employeeId,
        start_date: startDate,
        end_date: endDate,
        reason,
      })
      .select()
      .single();

    if (error) console.error('[Shift Service] Create time off request error:', error.message);
    return data;
  }

  async approveTimeOffRequest(requestId: string, approvedByUserId: string) {
    const { data, error } = await this.supabase
      .from('time_off_requests')
      .update({
        status: 'approved',
        approved_by_id: approvedByUserId,
      })
      .eq('id', requestId)
      .eq('company_id', this.companyId)
      .select()
      .single();

    if (error) console.error('[Shift Service] Approve time off error:', error.message);
    return data;
  }

  // ──────────────────────────────────────────────────────────────
  // Shift Templates
  // ──────────────────────────────────────────────────────────────

  async getShiftTemplates(departmentId?: string) {
    let query = this.supabase
      .from('shift_templates')
      .select('*')
      .eq('company_id', this.companyId);

    if (departmentId) {
      query = query.eq('department_id', departmentId);
    }

    const { data, error } = await query;
    if (error) console.error('[Shift Service] Get shift templates error:', error.message);
    return data || [];
  }

  async createShiftTemplate(
    name: string,
    startTime: string,
    endTime: string,
    departmentId?: string,
    breakMinutes: number = 0
  ) {
    const { data, error } = await this.supabase
      .from('shift_templates')
      .insert({
        company_id: this.companyId,
        name,
        start_time: startTime,
        end_time: endTime,
        department_id: departmentId,
        break_minutes: breakMinutes,
      })
      .select()
      .single();

    if (error) console.error('[Shift Service] Create shift template error:', error.message);
    return data;
  }

  // ──────────────────────────────────────────────────────────────
  // Individual Shifts (Ad-hoc shifts)
  // ──────────────────────────────────────────────────────────────

  async getShiftById(shiftId: string) {
    const { data, error } = await this.supabase
      .from('shifts')
      .select('*, employee:employees(id, first_name, last_name), department:departments(id, name)')
      .eq('id', shiftId)
      .eq('company_id', this.companyId)
      .maybeSingle();

    if (error) console.error('[Shift Service] Get shift by ID error:', error.message);
    return data;
  }

  async listShifts(options: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
    shiftType?: string;
    employeeId?: string;
    sortBy?: 'shift_date' | 'created_at' | 'status';
    sortOrder?: 'asc' | 'desc';
    dateFrom?: string;
    dateTo?: string;
  } = {}) {
    const {
      page = 1,
      pageSize = 20,
      search,
      status,
      shiftType,
      employeeId,
      sortBy = 'shift_date',
      sortOrder = 'desc',
      dateFrom,
      dateTo,
    } = options;

    let query = this.supabase
      .from('shifts')
      .select('*, employee:employees(id, first_name, last_name), department:departments(id, name)', {
        count: 'exact',
      })
      .eq('company_id', this.companyId);

    if (search) {
      query = query.or(`notes.ilike.%${search}%`);
    }
    if (status) query = query.eq('status', status);
    if (shiftType) query = query.eq('shift_type', shiftType);
    if (employeeId) query = query.eq('employee_id', employeeId);
    if (dateFrom) query = query.gte('shift_date', dateFrom);
    if (dateTo) query = query.lte('shift_date', dateTo);

    const ascending = sortOrder === 'asc';
    query = query.order(sortBy, { ascending });

    const offset = (page - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);

    const { data, error, count } = await query;
    if (error) console.error('[Shift Service] List shifts error:', error.message);

    return {
      data: data || [],
      total: count || 0,
      page,
      pageSize,
      totalPages: count ? Math.ceil(count / pageSize) : 0,
    };
  }

  async createShift(
    employeeId: string,
    shiftDate: string,
    startTime: string,
    endTime: string,
    shiftType: string,
    departmentId: string | null,
    notes: string | null,
    createdByUserId: string
  ) {
    const { data, error } = await this.supabase
      .from('shifts')
      .insert({
        company_id: this.companyId,
        employee_id: employeeId,
        shift_date: shiftDate,
        start_time: startTime,
        end_time: endTime,
        shift_type: shiftType,
        department_id: departmentId,
        notes,
        created_by_id: createdByUserId,
      })
      .select()
      .single();

    if (error) console.error('[Shift Service] Create shift error:', error.message);
    return data;
  }

  async updateShift(shiftId: string, updates: Record<string, any>) {
    const { data, error } = await this.supabase
      .from('shifts')
      .update(updates)
      .eq('id', shiftId)
      .eq('company_id', this.companyId)
      .select()
      .single();

    if (error) console.error('[Shift Service] Update shift error:', error.message);
    return data;
  }

  async deleteShift(shiftId: string) {
    const { error } = await this.supabase
      .from('shifts')
      .delete()
      .eq('id', shiftId)
      .eq('company_id', this.companyId);

    if (error) console.error('[Shift Service] Delete shift error:', error.message);
    return !error;
  }
}
