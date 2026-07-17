/**
 * Conversation Context Service
 * Manages per-user, per-company, per-conversation state
 * Tracks recently accessed/created entities and pending actions
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { ConversationContextData, RecentEntity, StoredConversationContext } from './types';

export class ConversationContextService {
  constructor(
    private supabase: SupabaseClient,
    private userId: string,
    private companyId: string,
    private conversationId: string
  ) {}

  /**
   * Load or initialize context for this conversation
   */
  async getContext(): Promise<ConversationContextData> {
    const { data, error } = await this.supabase
      .from('brain_conversation_contexts')
      .select('context')
      .eq('user_id', this.userId)
      .eq('company_id', this.companyId)
      .eq('conversation_id', this.conversationId)
      .maybeSingle();

    if (error) {
      console.error('[Context Service] Load error:', error.message);
      return this.getEmptyContext();
    }

    if (!data) {
      // Create new context
      return this.getEmptyContext();
    }

    return data.context as ConversationContextData;
  }

  /**
   * Update context after entity creation
   */
  async recordEntityCreated(
    entityType: 'task' | 'employee' | 'inventory_item' | 'customer',
    entityId: string,
    displayName: string
  ): Promise<void> {
    const context = await this.getContext();

    // Update last_*_id
    if (entityType === 'task') {
      context.last_created_task_id = entityId;
      context.last_modified_task_id = entityId;
    } else if (entityType === 'employee') {
      context.last_employee_id = entityId;
    } else if (entityType === 'inventory_item') {
      context.last_inventory_item_id = entityId;
    } else if (entityType === 'customer') {
      context.last_customer_id = entityId;
    }

    // Add to recent_entities (keep last 20)
    context.recent_entities = [
      {
        entity_type: entityType,
        entity_id: entityId,
        display_name: displayName,
        action: 'created' as const,
        occurred_at: new Date().toISOString(),
      },
      ...context.recent_entities,
    ].slice(0, 20);

    await this.saveContext(context);
  }

  /**
   * Update context after entity modification
   */
  async recordEntityModified(
    entityType: 'task' | 'employee' | 'inventory_item' | 'customer',
    entityId: string,
    displayName: string
  ): Promise<void> {
    const context = await this.getContext();

    // Update last_modified_*_id
    if (entityType === 'task') {
      context.last_modified_task_id = entityId;
    } else if (entityType === 'employee') {
      context.last_employee_id = entityId;
    }

    // Add/update in recent_entities
    const existingIdx = context.recent_entities.findIndex(e => e.entity_id === entityId);
    if (existingIdx >= 0) {
      context.recent_entities.splice(existingIdx, 1);
    }
    context.recent_entities = [
      {
        entity_type: entityType,
        entity_id: entityId,
        display_name: displayName,
        action: 'modified' as const,
        occurred_at: new Date().toISOString(),
      },
      ...context.recent_entities,
    ].slice(0, 20);

    await this.saveContext(context);
  }

  /**
   * Update context after entity view/access
   */
  async recordEntityViewed(
    entityType: string,
    entityId: string,
    displayName: string
  ): Promise<void> {
    const context = await this.getContext();

    if (entityType === 'task') {
      context.last_viewed_task_id = entityId;
    }

    // Add to recent_entities
    const existingIdx = context.recent_entities.findIndex(e => e.entity_id === entityId);
    if (existingIdx >= 0) {
      context.recent_entities.splice(existingIdx, 1);
    }
    context.recent_entities = [
      {
        entity_type: entityType as any,
        entity_id: entityId,
        display_name: displayName,
        action: 'viewed' as const,
        occurred_at: new Date().toISOString(),
      },
      ...context.recent_entities,
    ].slice(0, 20);

    await this.saveContext(context);
  }

  /**
   * Clear context when conversation ends or resets
   */
  async clearContext(): Promise<void> {
    const { error } = await this.supabase
      .from('brain_conversation_contexts')
      .delete()
      .eq('user_id', this.userId)
      .eq('company_id', this.companyId)
      .eq('conversation_id', this.conversationId);

    if (error) {
      console.error('[Context Service] Clear error:', error.message);
    }
  }

  /**
   * Get empty context template
   */
  private getEmptyContext(): ConversationContextData {
    return {
      last_created_task_id: null,
      last_viewed_task_id: null,
      last_modified_task_id: null,
      last_employee_id: null,
      last_inventory_item_id: null,
      last_customer_id: null,
      last_completed_action_id: null,
      recent_entities: [],
      recent_actions: [],
    };
  }

  /**
   * Save context to database
   */
  private async saveContext(context: ConversationContextData): Promise<void> {
    const existing = await this.supabase
      .from('brain_conversation_contexts')
      .select('id')
      .eq('user_id', this.userId)
      .eq('company_id', this.companyId)
      .eq('conversation_id', this.conversationId)
      .maybeSingle();

    if (existing.data) {
      // Update existing
      const { error } = await this.supabase
        .from('brain_conversation_contexts')
        .update({ context })
        .eq('id', existing.data.id);

      if (error) {
        console.error('[Context Service] Update error:', error.message);
      }
    } else {
      // Insert new
      const { error } = await this.supabase
        .from('brain_conversation_contexts')
        .insert({
          user_id: this.userId,
          company_id: this.companyId,
          conversation_id: this.conversationId,
          context,
        });

      if (error) {
        console.error('[Context Service] Insert error:', error.message);
      }
    }
  }
}
