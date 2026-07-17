/**
 * Action History Service
 * Tracks completed actions for undo, audit, and "what did I just do?" queries
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { ActionHistoryRecord } from './types';

export class ActionHistoryService {
  constructor(
    private supabase: SupabaseClient,
    private userId: string,
    private companyId: string,
    private conversationId: string
  ) {}

  /**
   * Record a completed action
   */
  async recordAction(
    actionType: string,
    entityType: string,
    entityId: string | null,
    beforeState: Record<string, unknown> | null,
    afterState: Record<string, unknown> | null,
    reversible: boolean = false
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('brain_action_history')
      .insert({
        company_id: this.companyId,
        user_id: this.userId,
        conversation_id: this.conversationId,
        action_type: actionType,
        entity_type: entityType,
        entity_id: entityId,
        before_state: beforeState,
        after_state: afterState,
        reversible: reversible,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[Action History] Record error:', error.message);
      return null;
    }

    return data?.id || null;
  }

  /**
   * Get the last action of a specific type in this conversation
   */
  async getLastAction(actionType?: string): Promise<ActionHistoryRecord | null> {
    let query = this.supabase
      .from('brain_action_history')
      .select('*')
      .eq('user_id', this.userId)
      .eq('company_id', this.companyId)
      .eq('conversation_id', this.conversationId)
      .is('reversed_at', null) // Only non-reversed actions
      .order('created_at', { ascending: false })
      .limit(1);

    if (actionType) {
      query = query.eq('action_type', actionType);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error('[Action History] Get last action error:', error.message);
      return null;
    }

    return data as ActionHistoryRecord | null;
  }

  /**
   * Get the last action for a specific entity
   */
  async getLastActionForEntity(entityId: string): Promise<ActionHistoryRecord | null> {
    const { data, error } = await this.supabase
      .from('brain_action_history')
      .select('*')
      .eq('user_id', this.userId)
      .eq('company_id', this.companyId)
      .eq('conversation_id', this.conversationId)
      .eq('entity_id', entityId)
      .is('reversed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[Action History] Get last entity action error:', error.message);
      return null;
    }

    return data as ActionHistoryRecord | null;
  }

  /**
   * Mark an action as reversed
   */
  async markReversed(actionId: string, reversingActionId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('brain_action_history')
      .update({
        reversed_at: new Date().toISOString(),
        reversed_by_action_id: reversingActionId,
      })
      .eq('id', actionId);

    if (error) {
      console.error('[Action History] Mark reversed error:', error.message);
      return false;
    }

    return true;
  }

  /**
   * Get recent actions in this conversation
   */
  async getRecentActions(limit: number = 10): Promise<ActionHistoryRecord[]> {
    const { data, error } = await this.supabase
      .from('brain_action_history')
      .select('*')
      .eq('user_id', this.userId)
      .eq('company_id', this.companyId)
      .eq('conversation_id', this.conversationId)
      .is('reversed_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Action History] Get recent actions error:', error.message);
      return [];
    }

    return (data || []) as ActionHistoryRecord[];
  }
}
