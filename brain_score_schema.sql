-- Brain Score snapshots table (historical audit trail)
CREATE TABLE IF NOT EXISTS brain_score_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  total_score NUMERIC NOT NULL,
  operations_score NUMERIC NOT NULL,
  employees_score NUMERIC NOT NULL,
  inventory_score NUMERIC NOT NULL,
  customers_score NUMERIC NOT NULL,
  data_quality_score NUMERIC NOT NULL,
  metrics JSONB NOT NULL,
  calculated_at TIMESTAMP DEFAULT now()
);

-- Index for company_id
CREATE INDEX IF NOT EXISTS idx_brain_score_snapshots_company_id ON brain_score_snapshots(company_id);
CREATE INDEX IF NOT EXISTS idx_brain_score_snapshots_calculated_at ON brain_score_snapshots(calculated_at DESC);

-- Row Level Security Policies for brain_score_snapshots
CREATE POLICY "Users can select brain scores from their company"
  ON brain_score_snapshots FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can create brain scores for their company"
  ON brain_score_snapshots FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Enable RLS
ALTER TABLE brain_score_snapshots ENABLE ROW LEVEL SECURITY;
