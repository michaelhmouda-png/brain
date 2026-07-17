-- Tasks table for AI-assisted task management
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  assigned_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  due_date DATE,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Index for company_id (RLS filtering)
CREATE INDEX IF NOT EXISTS idx_tasks_company_id ON tasks(company_id);

-- Index for assigned employee (common query)
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_employee ON tasks(assigned_employee_id);

-- Index for status (common filtering)
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Index for due_date (common filtering)
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);

-- Index for created_by (audit/filtering)
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);

-- Row Level Security Policy: Users can only see tasks for their company
CREATE POLICY "Users can select tasks from their company"
  ON tasks FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

-- RLS Policy: Users can insert tasks for their company
CREATE POLICY "Users can create tasks for their company"
  ON tasks FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

-- RLS Policy: Users can update tasks in their company
CREATE POLICY "Users can update tasks in their company"
  ON tasks FOR UPDATE
  USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

-- RLS Policy: Users can delete tasks in their company
CREATE POLICY "Users can delete tasks in their company"
  ON tasks FOR DELETE
  USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Enable RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Trigger to update updated_at on modification
CREATE OR REPLACE FUNCTION update_tasks_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_update_timestamp
BEFORE UPDATE ON tasks
FOR EACH ROW
EXECUTE FUNCTION update_tasks_timestamp();
