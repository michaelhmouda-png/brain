/**
 * Announcements Service
 * Handles announcement and acknowledgment operations with RLS enforcement
 */

import { SupabaseClient } from '@supabase/supabase-js';

interface ListOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  priority?: string;
  includeExpired?: boolean;
  sortBy?: 'published_at' | 'priority' | 'expires_at';
  sortOrder?: 'asc' | 'desc';
}

export class AnnouncementsService {
  constructor(
    private supabase: SupabaseClient,
    private companyId: string
  ) {}

  // ──────────────────────────────────────────────────────────────
  // Announcements - CRUD + Search
  // ──────────────────────────────────────────────────────────────

  async listAnnouncements(options: ListOptions = {}) {
    const {
      page = 1,
      pageSize = 20,
      search,
      priority,
      includeExpired = false,
      sortBy = 'published_at',
      sortOrder = 'desc',
    } = options;

    let query = this.supabase
      .from('announcements')
      .select('*, created_by:profiles(id, email)', {
        count: 'exact',
      })
      .eq('company_id', this.companyId);

    // Text search
    if (search) {
      query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%`);
    }

    // Filter by priority
    if (priority) {
      query = query.eq('priority', priority);
    }

    // Exclude expired unless requested
    if (!includeExpired) {
      const now = new Date().toISOString();
      query = query.or(`expires_at.is.null,expires_at.gt.${now}`);
    }

    // Sorting
    const ascending = sortOrder === 'asc';
    query = query.order(sortBy, { ascending });

    // Pagination
    const offset = (page - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);

    const { data, error, count } = await query;
    if (error) console.error('[Announcements Service] List announcements error:', error.message);

    return {
      data: data || [],
      total: count || 0,
      page,
      pageSize,
      totalPages: count ? Math.ceil(count / pageSize) : 0,
    };
  }

  async getAnnouncements(includeExpired: boolean = false) {
    let query = this.supabase
      .from('announcements')
      .select('*, created_by:profiles(id, email)')
      .eq('company_id', this.companyId);

    if (!includeExpired) {
      const now = new Date().toISOString();
      query = query.or(`expires_at.is.null,expires_at.gt.${now}`);
    }

    const { data, error } = await query.order('published_at', { ascending: false });
    if (error) console.error('[Announcements Service] Get announcements error:', error.message);
    return data || [];
  }

  async getAnnouncementById(announcementId: string) {
    const { data, error } = await this.supabase
      .from('announcements')
      .select('*, created_by:profiles(*)')
      .eq('company_id', this.companyId)
      .eq('id', announcementId)
      .maybeSingle();

    if (error) console.error('[Announcements Service] Get announcement by ID error:', error.message);
    return data;
  }

  async createAnnouncement(
    title: string,
    content: string,
    priority: 'low' | 'normal' | 'high' | 'urgent',
    createdByUserId: string,
    expiresAt?: string
  ) {
    const { data, error } = await this.supabase
      .from('announcements')
      .insert({
        company_id: this.companyId,
        title,
        content,
        priority,
        created_by_id: createdByUserId,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error) console.error('[Announcements Service] Create announcement error:', error.message);
    return data;
  }

  async updateAnnouncement(announcementId: string, updates: Record<string, any>) {
    const { data, error } = await this.supabase
      .from('announcements')
      .update(updates)
      .eq('id', announcementId)
      .eq('company_id', this.companyId)
      .select()
      .single();

    if (error) console.error('[Announcements Service] Update announcement error:', error.message);
    return data;
  }

  async deleteAnnouncement(announcementId: string) {
    const { error } = await this.supabase
      .from('announcements')
      .delete()
      .eq('id', announcementId)
      .eq('company_id', this.companyId);

    if (error) console.error('[Announcements Service] Delete announcement error:', error.message);
    return !error;
  }

  // ──────────────────────────────────────────────────────────────
  // Acknowledgments
  // ──────────────────────────────────────────────────────────────

  async acknowledgeAnnouncement(announcementId: string, employeeId: string) {
    const { data, error } = await this.supabase
      .from('announcement_acknowledgments')
      .insert({
        company_id: this.companyId,
        announcement_id: announcementId,
        employee_id: employeeId,
      })
      .select()
      .single();

    if (error) {
      // If already acknowledged, that's okay
      if (error.code === '23505') {
        return { already_acknowledged: true };
      }
      console.error('[Announcements Service] Acknowledge error:', error.message);
    }
    return data;
  }

  async getAcknowledgmentStats(announcementId: string) {
    // Get total employees in company
    const { count: totalEmployees, error: countError } = await this.supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', this.companyId);

    // Get acknowledgments for this announcement
    const { count: acknowledgedCount, error: ackError } = await this.supabase
      .from('announcement_acknowledgments')
      .select('id', { count: 'exact', head: true })
      .eq('announcement_id', announcementId)
      .eq('company_id', this.companyId);

    if (countError || ackError) {
      console.error('[Announcements Service] Get acknowledgment stats error');
      return { total: 0, acknowledged: 0, percentage: 0 };
    }

    return {
      total: totalEmployees || 0,
      acknowledged: acknowledgedCount || 0,
      percentage: totalEmployees ? Math.round(((acknowledgedCount || 0) / totalEmployees) * 100) : 0,
    };
  }

  async getUnacknowledgedAnnouncements(employeeId: string) {
    const { data, error } = await this.supabase
      .from('announcements')
      .select('*')
      .eq('company_id', this.companyId)
      .not('id', 'in', `(select announcement_id from announcement_acknowledgments where company_id = '${this.companyId}' and employee_id = '${employeeId}')`);

    if (error) console.error('[Announcements Service] Get unacknowledged error:', error.message);
    return data || [];
  }
}
