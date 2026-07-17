/**
 * Incidents Service
 * Handles incident report operations with RLS enforcement
 */

import { SupabaseClient } from '@supabase/supabase-js';

interface ListOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  severity?: string;
  incidentType?: string;
  sortBy?: 'incident_time' | 'severity' | 'status' | 'created_at';
  sortOrder?: 'asc' | 'desc';
  dateFrom?: string;
  dateTo?: string;
}

export class IncidentsService {
  constructor(
    private supabase: SupabaseClient,
    private companyId: string
  ) {}

  // ──────────────────────────────────────────────────────────────
  // Incident Reports - CRUD + Search
  // ──────────────────────────────────────────────────────────────

  async listIncidents(options: ListOptions = {}) {
    const {
      page = 1,
      pageSize = 20,
      search,
      status,
      severity,
      incidentType,
      sortBy = 'incident_time',
      sortOrder = 'desc',
      dateFrom,
      dateTo,
    } = options;

    let query = this.supabase
      .from('incident_reports')
      .select('*, reported_by:profiles(id, email), location:locations(id, name)', {
        count: 'exact',
      })
      .eq('company_id', this.companyId);

    // Text search
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,affected_area.ilike.%${search}%`);
    }

    // Filters
    if (status) query = query.eq('status', status);
    if (severity) query = query.eq('severity', severity);
    if (incidentType) query = query.eq('incident_type', incidentType);

    // Date range
    if (dateFrom) query = query.gte('incident_time', dateFrom);
    if (dateTo) query = query.lte('incident_time', dateTo);

    // Sorting
    const ascending = sortOrder === 'asc';
    query = query.order(sortBy, { ascending });

    // Pagination
    const offset = (page - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);

    const { data, error, count } = await query;
    if (error) console.error('[Incidents Service] List incidents error:', error.message);

    return {
      data: data || [],
      total: count || 0,
      page,
      pageSize,
      totalPages: count ? Math.ceil(count / pageSize) : 0,
    };
  }

  async getIncidents(status?: string, severity?: string) {
    let query = this.supabase
      .from('incident_reports')
      .select('*, reported_by:profiles(id, email)')
      .eq('company_id', this.companyId);

    if (status) {
      query = query.eq('status', status);
    }

    if (severity) {
      query = query.eq('severity', severity);
    }

    const { data, error } = await query.order('incident_time', { ascending: false });
    if (error) console.error('[Incidents Service] Get incidents error:', error.message);
    return data || [];
  }

  async getIncidentById(incidentId: string) {
    const { data, error } = await this.supabase
      .from('incident_reports')
      .select('*, reported_by:profiles(*)')
      .eq('company_id', this.companyId)
      .eq('id', incidentId)
      .maybeSingle();

    if (error) console.error('[Incidents Service] Get incident by ID error:', error.message);
    return data;
  }

  async getRecentIncidents(days: number = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await this.supabase
      .from('incident_reports')
      .select('*')
      .eq('company_id', this.companyId)
      .gte('incident_time', startDate.toISOString())
      .order('incident_time', { ascending: false });

    if (error) console.error('[Incidents Service] Get recent incidents error:', error.message);
    return data || [];
  }

  async createIncident(
    title: string,
    description: string,
    incidentType: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    locationId: string | null,
    affectedArea: string | null,
    incidentTime: string,
    reportedByUserId: string
  ) {
    const { data, error } = await this.supabase
      .from('incident_reports')
      .insert({
        company_id: this.companyId,
        title,
        description,
        incident_type: incidentType,
        severity,
        location_id: locationId,
        affected_area: affectedArea,
        incident_time: incidentTime,
        reported_by_id: reportedByUserId,
      })
      .select()
      .single();

    if (error) console.error('[Incidents Service] Create incident error:', error.message);
    return data;
  }

  async updateIncidentStatus(incidentId: string, status: string) {
    const { data, error } = await this.supabase
      .from('incident_reports')
      .update({ status })
      .eq('id', incidentId)
      .eq('company_id', this.companyId)
      .select()
      .single();

    if (error) console.error('[Incidents Service] Update incident status error:', error.message);
    return data;
  }

  async updateIncident(incidentId: string, updates: Record<string, any>) {
    const { data, error } = await this.supabase
      .from('incident_reports')
      .update(updates)
      .eq('id', incidentId)
      .eq('company_id', this.companyId)
      .select()
      .single();

    if (error) console.error('[Incidents Service] Update incident error:', error.message);
    return data;
  }

  async archiveIncident(incidentId: string) {
    return this.updateIncidentStatus(incidentId, 'closed');
  }

  async getCriticalIncidents() {
    const { data, error } = await this.supabase
      .from('incident_reports')
      .select('*')
      .eq('company_id', this.companyId)
      .eq('severity', 'critical')
      .not('status', 'in', '(closed)');

    if (error) console.error('[Incidents Service] Get critical incidents error:', error.message);
    return data || [];
  }
}
