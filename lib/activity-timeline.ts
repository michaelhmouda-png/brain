/**
 * Activity Timeline Service
 * Tracks all company activity for audit trail and dashboard
 */

import { SupabaseClient } from '@supabase/supabase-js';

export class ActivityTimelineService {
  constructor(
    private supabase: SupabaseClient,
    private companyId: string
  ) {}

  // ──────────────────────────────────────────────────────────────
  // Activity Logging
  // ──────────────────────────────────────────────────────────────

  async logActivity(
    actionByUserId: string,
    actionType: string,
    entityType: string,
    entityId: string,
    entityName: string,
    details?: Record<string, any>
  ) {
    const { data, error } = await this.supabase
      .from('activity_timeline')
      .insert({
        company_id: this.companyId,
        action_by_id: actionByUserId,
        action_type: actionType,
        entity_type: entityType,
        entity_id: entityId,
        entity_name: entityName,
        details: details || {},
      })
      .select()
      .single();

    if (error) console.error('[Activity Timeline Service] Log activity error:', error.message);
    return data;
  }

  // ──────────────────────────────────────────────────────────────
  // Activity Retrieval
  // ──────────────────────────────────────────────────────────────

  async getActivityTimeline(limit: number = 50, offset: number = 0) {
    const { data, error } = await this.supabase
      .from('activity_timeline')
      .select('*, action_by:profiles(id, email)')
      .eq('company_id', this.companyId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) console.error('[Activity Timeline Service] Get timeline error:', error.message);
    return data || [];
  }

  async getActivityForEntity(entityType: string, entityId: string) {
    const { data, error } = await this.supabase
      .from('activity_timeline')
      .select('*, action_by:profiles(id, email)')
      .eq('company_id', this.companyId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false });

    if (error) console.error('[Activity Timeline Service] Get activity for entity error:', error.message);
    return data || [];
  }

  async getActivityByType(actionType: string, limit: number = 50) {
    const { data, error } = await this.supabase
      .from('activity_timeline')
      .select('*, action_by:profiles(id, email)')
      .eq('company_id', this.companyId)
      .eq('action_type', actionType)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) console.error('[Activity Timeline Service] Get activity by type error:', error.message);
    return data || [];
  }

  async getRecentActivity(days: number = 1) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await this.supabase
      .from('activity_timeline')
      .select('*, action_by:profiles(id, email)')
      .eq('company_id', this.companyId)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false });

    if (error) console.error('[Activity Timeline Service] Get recent activity error:', error.message);
    return data || [];
  }

  async getActivityByUser(userId: string) {
    const { data, error } = await this.supabase
      .from('activity_timeline')
      .select('*')
      .eq('company_id', this.companyId)
      .eq('action_by_id', userId)
      .order('created_at', { ascending: false });

    if (error) console.error('[Activity Timeline Service] Get activity by user error:', error.message);
    return data || [];
  }

  // ──────────────────────────────────────────────────────────────
  // Bulk Logging
  // ──────────────────────────────────────────────────────────────

  async logActivities(
    activities: Array<{
      actionByUserId: string;
      actionType: string;
      entityType: string;
      entityId: string;
      entityName: string;
      details?: Record<string, any>;
    }>
  ) {
    const records = activities.map(a => ({
      company_id: this.companyId,
      action_by_id: a.actionByUserId,
      action_type: a.actionType,
      entity_type: a.entityType,
      entity_id: a.entityId,
      entity_name: a.entityName,
      details: a.details || {},
    }));

    const { error } = await this.supabase
      .from('activity_timeline')
      .insert(records);

    if (error) console.error('[Activity Timeline Service] Bulk log error:', error.message);
    return !error;
  }
}
