/**
 * Types for Brain Conversational Context & Memory System
 */

export interface RecentEntity {
  entity_type: 'task' | 'employee' | 'inventory_item' | 'customer';
  entity_id: string;
  display_name: string;
  action: 'created' | 'viewed' | 'modified' | 'completed' | 'deleted';
  occurred_at: string; // ISO timestamp
}

export interface RecentAction {
  action_id: string;
  action_type: 'create_task' | 'update_task' | 'complete_task' | 'delete_task' | 'update_employee' | 'create_inventory_item';
  entity_type: 'task' | 'employee' | 'inventory_item' | 'customer';
  entity_id: string;
  occurred_at: string; // ISO timestamp
}

export interface ConversationContextData {
  last_created_task_id: string | null;
  last_viewed_task_id: string | null;
  last_modified_task_id: string | null;
  last_employee_id: string | null;
  last_inventory_item_id: string | null;
  last_customer_id: string | null;
  last_completed_action_id: string | null;
  recent_entities: RecentEntity[];
  recent_actions: RecentAction[];
}

export interface StoredConversationContext {
  id: string;
  company_id: string;
  user_id: string;
  conversation_id: string;
  context: ConversationContextData;
  created_at: string;
  updated_at: string;
}

export interface ActionHistoryRecord {
  id: string;
  company_id: string;
  user_id: string;
  conversation_id: string;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  reversible: boolean;
  reversed_at: string | null;
  reversed_by_action_id: string | null;
  created_at: string;
}

export interface ReferenceCandidate {
  entity_type: string;
  entity_id: string;
  display_name: string;
  source: 'pending_action' | 'recent_entities' | 'database_lookup';
  score: number; // Higher = more relevant
}

export interface PendingActionPlan {
  id: string;
  version: number; // Increment when user edits
  tool: string;
  arguments: Record<string, unknown>;
  original_arguments: Record<string, unknown>; // For comparison
  created_at: string;
  edited_at: string | null;
  edits_count: number;
}
