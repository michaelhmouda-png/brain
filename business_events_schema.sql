-- Business Events Timeline table (unified activity audit trail)
CREATE TABLE IF NOT EXISTS business_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  module TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT,
  actor_user_id UUID,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  occurred_at TIMESTAMP DEFAULT now(),
  created_at TIMESTAMP DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_business_events_company_id ON business_events(company_id);
CREATE INDEX IF NOT EXISTS idx_business_events_occurred_at ON business_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_events_company_occurred ON business_events(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_events_event_type ON business_events(event_type);
CREATE INDEX IF NOT EXISTS idx_business_events_module ON business_events(module);

-- Row Level Security Policy for business_events
CREATE POLICY "Users can select business events from their company"
  ON business_events FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can create business events for their company"
  ON business_events FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Enable RLS
ALTER TABLE business_events ENABLE ROW LEVEL SECURITY;

-- Supported event types for reference
-- task_created
-- task_assigned
-- task_completed
-- task_overdue
-- inventory_movement
-- low_stock_detected
-- customer_interaction
-- customer_complaint
-- employee_created
-- employee_updated
-- brain_score_changed
