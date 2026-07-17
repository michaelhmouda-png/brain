/**
 * Reference Resolver
 * Deterministically resolves conversational references like "it", "that", "the last task", etc.
 * Resolution priority:
 * 1. Explicit ID or exact name in current message
 * 2. Pending action currently being edited
 * 3. Most recent matching entity in same conversation
 * 4. Most recent matching entity modified by same user
 * 5. Ask for clarification
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { ConversationContextData, ReferenceCandidate } from './types';

export class ReferenceResolver {
  constructor(
    private supabase: SupabaseClient,
    private userId: string,
    private companyId: string,
    private conversationId: string
  ) {}

  /**
   * Resolve a reference in natural language to an entity ID
   * Examples: "it", "that", "the task", "the last employee", "him", "her"
   */
  async resolveReference(
    referenceText: string,
    context: ConversationContextData,
    expectedType?: 'task' | 'employee' | 'inventory_item' | 'customer'
  ): Promise<{ entity_id: string; entity_type: string; display_name: string } | null> {
    const normalized = referenceText.toLowerCase().trim();

    // Pronouns and generic references
    const pronouns = ['it', 'that', 'this', 'him', 'her', 'them'];
    const isGenericReference = pronouns.some(p => normalized === p || normalized.startsWith(p + ' '));

    if (!isGenericReference && expectedType) {
      // Try exact name lookup first
      const exactMatch = await this.lookupByName(referenceText, expectedType);
      if (exactMatch) {
        return exactMatch;
      }
    }

    // If generic reference, resolve from context
    if (isGenericReference) {
      return this.resolveFromContext(normalized, context, expectedType);
    }

    // If specific phrase, parse it
    if (normalized.includes('task')) {
      return this.resolveFromContext(normalized, context, 'task');
    }
    if (normalized.includes('employee')) {
      return this.resolveFromContext(normalized, context, 'employee');
    }
    if (normalized.includes('item')) {
      return this.resolveFromContext(normalized, context, 'inventory_item');
    }
    if (normalized.includes('customer')) {
      return this.resolveFromContext(normalized, context, 'customer');
    }

    return null;
  }

  /**
   * Resolve reference from conversation context
   * Priority: most recent entity of matching type
   */
  private resolveFromContext(
    referenceText: string,
    context: ConversationContextData,
    expectedType?: string
  ): { entity_id: string; entity_type: string; display_name: string } | null {
    const normalized = referenceText.toLowerCase();

    // Most recent / last references
    if (normalized.includes('last')) {
      if (!expectedType || expectedType === 'task') {
        if (context.last_created_task_id || context.last_modified_task_id) {
          const taskId = context.last_modified_task_id || context.last_created_task_id;
          if (taskId) {
            const entity = context.recent_entities.find(
              e => e.entity_id === taskId && e.entity_type === 'task'
            );
            if (entity) {
              return { entity_id: taskId, entity_type: 'task', display_name: entity.display_name };
            }
          }
        }
      }

      if (!expectedType || expectedType === 'employee') {
        if (context.last_employee_id) {
          const entity = context.recent_entities.find(
            e => e.entity_id === context.last_employee_id && e.entity_type === 'employee'
          );
          if (entity) {
            return { entity_id: context.last_employee_id, entity_type: 'employee', display_name: entity.display_name };
          }
        }
      }

      if (!expectedType || expectedType === 'inventory_item') {
        if (context.last_inventory_item_id) {
          const entity = context.recent_entities.find(
            e => e.entity_id === context.last_inventory_item_id && e.entity_type === 'inventory_item'
          );
          if (entity) {
            return {
              entity_id: context.last_inventory_item_id,
              entity_type: 'inventory_item',
              display_name: entity.display_name,
            };
          }
        }
      }

      if (!expectedType || expectedType === 'customer') {
        if (context.last_customer_id) {
          const entity = context.recent_entities.find(
            e => e.entity_id === context.last_customer_id && e.entity_type === 'customer'
          );
          if (entity) {
            return { entity_id: context.last_customer_id, entity_type: 'customer', display_name: entity.display_name };
          }
        }
      }
    }

    // Generic "it", "that", "this" — use most recent entity of expected type
    if (!expectedType || expectedType === 'task') {
      if (context.recent_entities.length > 0) {
        const recentTask = [...context.recent_entities]
          .reverse()
          .find(e => e.entity_type === 'task');
        if (recentTask) {
          return { entity_id: recentTask.entity_id, entity_type: 'task', display_name: recentTask.display_name };
        }
      }
    }

    return null;
  }

  /**
   * Look up entity by name
   */
  private async lookupByName(
    name: string,
    entityType: string
  ): Promise<{ entity_id: string; entity_type: string; display_name: string } | null> {
    try {
      if (entityType === 'employee') {
        const { data, error } = await this.supabase
          .from('employees')
          .select('id, first_name, last_name')
          .eq('company_id', this.companyId)
          .ilike('first_name', `%${name}%`)
          .maybeSingle();

        if (data && !error) {
          return {
            entity_id: data.id,
            entity_type: 'employee',
            display_name: `${data.first_name} ${data.last_name}`,
          };
        }
      }

      if (entityType === 'task') {
        const { data, error } = await this.supabase
          .from('tasks')
          .select('id, title')
          .eq('company_id', this.companyId)
          .ilike('title', `%${name}%`)
          .maybeSingle();

        if (data && !error) {
          return {
            entity_id: data.id,
            entity_type: 'task',
            display_name: data.title,
          };
        }
      }
    } catch (err) {
      console.error('[Reference Resolver] Lookup error:', err);
    }

    return null;
  }

  /**
   * Get candidates for ambiguous references
   * Used to ask user for clarification
   */
  async getCandidates(
    referenceText: string,
    context: ConversationContextData,
    expectedType?: string
  ): Promise<ReferenceCandidate[]> {
    const candidates: ReferenceCandidate[] = [];

    // Add recent entities of matching type
    if (!expectedType || expectedType === 'task') {
      const recentTasks = context.recent_entities
        .filter(e => e.entity_type === 'task')
        .slice(0, 5)
        .map((e, idx) => ({
          entity_type: 'task',
          entity_id: e.entity_id,
          display_name: e.display_name,
          source: 'recent_entities' as const,
          score: 100 - idx * 10, // Higher score for more recent
        }));
      candidates.push(...recentTasks);
    }

    if (!expectedType || expectedType === 'employee') {
      const recentEmployees = context.recent_entities
        .filter(e => e.entity_type === 'employee')
        .slice(0, 5)
        .map((e, idx) => ({
          entity_type: 'employee',
          entity_id: e.entity_id,
          display_name: e.display_name,
          source: 'recent_entities' as const,
          score: 100 - idx * 10,
        }));
      candidates.push(...recentEmployees);
    }

    return candidates.sort((a, b) => b.score - a.score);
  }
}
