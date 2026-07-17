-- Brain Action History table
-- Stores completed actions for undo, audit, and answering "what did I just create?"
-- Only stores fields necessary for safe undo and follow-up

CREATE TABLE IF NOT EXISTS public.brain_action_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  
  -- Action classification
  action_type TEXT NOT NULL CHECK (action_type IN ('create_task', 'update_task', 'complete_task', 'delete_task', 'update_employee', 'create_inventory_item')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('task', 'employee', 'inventory_item', 'customer')),
  entity_id UUID,
  
  -- State snapshots for undo
  before_state JSONB,
  after_state JSONB,
  
  -- Undo tracking
  reversible BOOLEAN NOT NULL DEFAULT FALSE,
  reversed_at TIMESTAMPTZ,
  reversed_by_action_id UUID REFERENCES public.brain_action_history(id) ON DELETE SET NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_brain_action_history_user_company 
  ON public.brain_action_history(user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_brain_action_history_conversation 
  ON public.brain_action_history(conversation_id, user_id);
CREATE INDEX IF NOT EXISTS idx_brain_action_history_entity 
  ON public.brain_action_history(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_brain_action_history_created_at 
  ON public.brain_action_history(created_at DESC);

-- RLS Policies
ALTER TABLE public.brain_action_history ENABLE ROW LEVEL SECURITY;

-- Users can only view their own action history in their company
CREATE POLICY "Users can view their own action history"
  ON public.brain_action_history
  FOR SELECT
  USING (
    auth.uid() = user_id 
    AND company_id = private.current_user_company_id()
    AND private.is_active_user()
  );

-- Users can insert their own action history
CREATE POLICY "Users can insert action history"
  ON public.brain_action_history
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id 
    AND company_id = private.current_user_company_id()
    AND private.can_manage_company(company_id)
  );

-- Users can update their own action history (for marking as reversed)
CREATE POLICY "Users can update action history"
  ON public.brain_action_history
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
GRANT SELECT, INSERT, UPDATE ON public.brain_action_history TO authenticated;
GRANT USAGE ON SEQUENCE public.brain_action_history_id_seq TO authenticated;
