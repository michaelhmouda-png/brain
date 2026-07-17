-- Customers table
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  email TEXT,
  birthday DATE,
  vip_status TEXT DEFAULT 'standard' CHECK (vip_status IN ('standard', 'silver', 'gold', 'platinum')),
  preferences TEXT,
  notes TEXT,
  total_visits INTEGER DEFAULT 0,
  total_spend NUMERIC DEFAULT 0,
  last_visit_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Customer interactions table (audit trail of all customer events)
CREATE TABLE IF NOT EXISTS customer_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('visit', 'reservation', 'complaint', 'compliment', 'no_show', 'message')),
  value NUMERIC,
  description TEXT,
  occurred_at TIMESTAMP DEFAULT now(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);

-- Indexes for customers
CREATE INDEX IF NOT EXISTS idx_customers_company_id ON customers(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_vip_status ON customers(vip_status);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_last_visit ON customers(last_visit_at DESC);

-- Indexes for customer_interactions
CREATE INDEX IF NOT EXISTS idx_customer_interactions_company_id ON customer_interactions(company_id);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_customer_id ON customer_interactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_type ON customer_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_occurred_at ON customer_interactions(occurred_at DESC);

-- Row Level Security Policies for customers
CREATE POLICY "Users can select customers from their company"
  ON customers FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can create customers for their company"
  ON customers FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update customers in their company"
  ON customers FOR UPDATE
  USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can delete customers in their company"
  ON customers FOR DELETE
  USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Row Level Security Policies for customer_interactions
CREATE POLICY "Users can select interactions from their company"
  ON customer_interactions FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can record interactions for their company"
  ON customer_interactions FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Enable RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_interactions ENABLE ROW LEVEL SECURITY;

-- Trigger to update customers timestamp
CREATE OR REPLACE FUNCTION update_customers_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customers_update_timestamp
BEFORE UPDATE ON customers
FOR EACH ROW
EXECUTE FUNCTION update_customers_timestamp();

-- Trigger to update customer stats when interaction is recorded
CREATE OR REPLACE FUNCTION update_customer_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.interaction_type = 'visit' THEN
    UPDATE customers
    SET total_visits = total_visits + 1,
        last_visit_at = NEW.occurred_at,
        total_spend = CASE WHEN NEW.value IS NOT NULL 
                         THEN total_spend + NEW.value 
                         ELSE total_spend 
                      END
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_customer_stats_trigger
AFTER INSERT ON customer_interactions
FOR EACH ROW
EXECUTE FUNCTION update_customer_stats();
