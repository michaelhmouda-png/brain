import { SupabaseClient } from '@supabase/supabase-js';

export class ShiftService {
  constructor(private supabase: SupabaseClient, private companyId: string) {}

  async getShifts(filters: {
    date?: string;
    employee_id?: string;
    status?: string;
    limit?: number;
  }) {
    let query = this.supabase
      .from('recurring_shifts')
      .select('*, employees:employee_id(first_name, last_name)')
      .eq('company_id', this.companyId);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.employee_id) query = query.eq('employee_id', filters.employee_id);
    if (filters.date) query = query.eq('shift_date', filters.date);

    const { data, error } = await query.limit(filters.limit || 20);
    if (error) throw error;
    return data || [];
  }

  async createShift(shiftData: {
    employee_id: string;
    shift_template_id: string;
    day_of_week: number;
    start_date: string;
    end_date?: string;
    created_by: string;
  }) {
    const { data, error } = await this.supabase
      .from('recurring_shifts')
      .insert({
        company_id: this.companyId,
        ...shiftData,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async updateShift(
    shiftId: string,
    updates: Record<string, any>
  ) {
    const { data, error } = await this.supabase
      .from('recurring_shifts')
      .update(updates)
      .eq('id', shiftId)
      .eq('company_id', this.companyId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async deleteShift(shiftId: string) {
    const { error } = await this.supabase
      .from('recurring_shifts')
      .delete()
      .eq('id', shiftId)
      .eq('company_id', this.companyId);

    if (error) throw error;
    return { success: true };
  }
}
