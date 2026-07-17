-- Brain Conversation Contexts table
-- Stores per-user, per-company, per-conversation state and entity references
-- Enables follow-up commands like "Make it high priority" to resolve "it"

CREATE TABLE IF NOT EXISTS public.brain_conversation_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  
  -- Context JSON structure:
  -- {
  --   last_created_task_id: UUID | null,
  --   last_viewed_task_id: UUID | null,
  --   last_modified_task_id: UUID | null,
  --   last_employee_id: UUID | null,
  --   last_inventory_item_id: UUID | null,
  --   last_customer_id: UUID | null,
  --   last_completed_action_id: UUID | null,
  --   recent_entities: Array<{ entity_type, entity_id, display_name, action, occurred_at }>,
  --   recent_actions: Array<{ action_id, action_type, entity_type, entity_id, occurred_at }>
  -- }
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT unique_conversation_context UNIQUE (user_id, company_id, conversation_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_brain_conversation_contexts_user_company 
  ON public.brain_conversation_contexts(user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_brain_conversation_contexts_conversation 
  ON public.brain_conversation_contexts(conversation_id, user_id);

-- RLS Policies
ALTER TABLE public.brain_conversation_contexts ENABLE ROW LEVEL SECURITY;

-- Users can only view their own conversation contexts in their company
CREATE POLICY "Users can view their own conversation contexts"
  ON public.brain_conversation_contexts
  FOR SELECT
  USING (
    auth.uid() = user_id 
    AND company_id = private.current_user_company_id()
    AND private.is_active_user()
  );

-- Users can insert their own conversation contexts
CREATE POLICY "Users can insert conversation contexts"
  ON public.brain_conversation_contexts
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id 
    AND company_id = private.current_user_company_id()
    AND private.can_manage_company(company_id)
  );

-- Users can update their own conversation contexts
CREATE POLICY "Users can update conversation contexts"
  ON public.brain_conversation_contexts
  FOR UPDATE
  USING (
    auth.uid() = user_id 
    AND company_id = private.current_user_company_id()
    AND private.is_active_user()
  )
  WITH CHECK (
    auth.uid() = user_id 
    AND company_id = private.current_user_company_id()
    AND private.can_manage_company(company_id)
  );

-- Grant default permissions to authenticated users
GRANT SELECT, INSERT, UPDATE ON public.brain_conversation_contexts TO authenticated;
GRANT USAGE ON SEQUENCE public.brain_conversation_contexts_id_seq TO authenticated;

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_brain_conversation_contexts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS brain_conversation_contexts_updated_at_trigger 
  ON public.brain_conversation_contexts;

CREATE TRIGGER brain_conversation_contexts_updated_at_trigger
  BEFORE UPDATE ON public.brain_conversation_contexts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_brain_conversation_contexts_updated_at();
