/**
 * Maintenance Service
 * Handles maintenance ticket operations with RLS enforcement
 */

import { SupabaseClient } from '@supabase/supabase-js';

interface ListOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  priority?: string;
  assignedToId?: string;
  sortBy?: 'created_at' | 'due_date' | 'priority' | 'status';
  sortOrder?: 'asc' | 'desc';
  dueDateFrom?: string;
  dueDateTo?: string;
}

export class MaintenanceService {
  constructor(
    private supabase: SupabaseClient,
    private companyId: string
  ) {}

  // ──────────────────────────────────────────────────────────────
  // Maintenance Tickets - CRUD + Search
  // ──────────────────────────────────────────────────────────────

  async listTickets(options: ListOptions = {}) {
    const {
      page = 1,
      pageSize = 20,
      search,
      status,
      priority,
      assignedToId,
      sortBy = 'created_at',
      sortOrder = 'desc',
      dueDateFrom,
      dueDateTo,
    } = options;

    let query = this.supabase
      .from('maintenance_tickets')
      .select('*, assigned_to:employees(id, first_name, last_name), created_by:profiles(id, full_name), location:locations(id, name)', {
        count: 'exact',
      })
      .eq('company_id', this.companyId);

    // Text search
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Filters
    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (assignedToId) query = query.eq('assigned_to_id', assignedToId);

    // Date range
    if (dueDateFrom) query = query.gte('due_date', dueDateFrom);
    if (dueDateTo) query = query.lte('due_date', dueDateTo);

    // Sorting
    const ascending = sortOrder === 'asc';
    query = query.order(sortBy, { ascending });

    // Pagination
    const offset = (page - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw new Error('MAINTENANCE_LIST_FAILED', { cause: error });

    return {
      data: data || [],
      total: count || 0,
      page,
      pageSize,
      totalPages: count ? Math.ceil(count / pageSize) : 0,
    };
  }

  async getTickets(status?: string, assignedToId?: string) {
    let query = this.supabase
      .from('maintenance_tickets')
      .select('*, assigned_to:employees(id, first_name, last_name), created_by:profiles(id, full_name)')
      .eq('company_id', this.companyId);

    if (status) {
      query = query.eq('status', status);
    }

    if (assignedToId) {
      query = query.eq('assigned_to_id', assignedToId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) console.error('[Maintenance Service] Get tickets error:', error.message);
    return data || [];
  }

  async getOverdueTickets() {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await this.supabase
      .from('maintenance_tickets')
      .select('*, assigned_to:employees(id, first_name, last_name)')
      .eq('company_id', this.companyId)
      .lt('due_date', today)
      .not('status', 'in', '(completed,cancelled)')
      .order('due_date', { ascending: true });

    if (error) console.error('[Maintenance Service] Get overdue tickets error:', error.message);
    return data || [];
  }

  async getTicketById(ticketId: string) {
    const { data, error } = await this.supabase
      .from('maintenance_tickets')
      .select('*, assigned_to:employees(*), created_by:profiles(*)')
      .eq('company_id', this.companyId)
      .eq('id', ticketId)
      .maybeSingle();

    if (error) console.error('[Maintenance Service] Get ticket by ID error:', error.message);
    return data;
  }

  async createTicket(
    title: string,
    description: string,
    priority: 'low' | 'medium' | 'high' | 'critical',
    locationId: string | null,
    assignedToId: string | null,
    dueDate: string | null,
    createdByUserId: string
  ) {
    const { data, error } = await this.supabase
      .from('maintenance_tickets')
      .insert({
        company_id: this.companyId,
        title,
        description,
        priority,
        location_id: locationId,
        assigned_to_id: assignedToId,
        due_date: dueDate,
        created_by_id: createdByUserId,
      })
      .select()
      .single();

    if (error) console.error('[Maintenance Service] Create ticket error:', error.message);
    return data;
  }

  async updateTicketStatus(ticketId: string, status: string, completionNotes?: string) {
    const updateData: Record<string, string | undefined> = { status };

    if (status === 'completed') {
      updateData.completed_at = new Date().toISOString();
      updateData.completion_notes = completionNotes;
    }

    const { data, error } = await this.supabase
      .from('maintenance_tickets')
      .update(updateData)
      .eq('id', ticketId)
      .eq('company_id', this.companyId)
      .select()
      .single();

    if (error) console.error('[Maintenance Service] Update ticket status error:', error.message);
    return data;
  }

  async assignTicket(ticketId: string, assignedToId: string) {
    const { data, error } = await this.supabase
      .from('maintenance_tickets')
      .update({
        assigned_to_id: assignedToId,
        status: 'assigned',
      })
      .eq('id', ticketId)
      .eq('company_id', this.companyId)
      .select()
      .single();

    if (error) console.error('[Maintenance Service] Assign ticket error:', error.message);
    return data;
  }

  async updateTicket(ticketId: string, updates: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('maintenance_tickets')
      .update(updates)
      .eq('id', ticketId)
      .eq('company_id', this.companyId)
      .select()
      .single();

    if (error) console.error('[Maintenance Service] Update ticket error:', error.message);
    return data;
  }

  async deleteTicket(ticketId: string) {
    const { error } = await this.supabase
      .from('maintenance_tickets')
      .delete()
      .eq('id', ticketId)
      .eq('company_id', this.companyId);

    if (error) console.error('[Maintenance Service] Delete ticket error:', error.message);
    return !error;
  }
}
