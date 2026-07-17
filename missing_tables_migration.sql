-- ============================================================
-- HospiBrain — Missing Tables Migration
-- Run this once in the Supabase SQL Editor (project: jjhtasppfxunbrswgxht)
-- ============================================================
-- Tables created by this file:
--   tasks
--   inventory_items
--   inventory_movements
--   customers
--   customer_interactions
--   brain_score_snapshots  (re-entrant — safe to re-run)
--   business_events        (re-entrant — safe to re-run)
-- ============================================================

-- ── 1. TASKS ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title                TEXT        NOT NULL,
  description          TEXT,
  priority             TEXT        NOT NULL DEFAULT 'Medium'
                                   CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
  status               TEXT        NOT NULL DEFAULT 'Pending'
                                   CHECK (status IN ('Pending', 'In Progress', 'Completed')),
  due_date             DATE,
  assigned_employee_id UUID        REFERENCES employees(id) ON DELETE SET NULL,
  created_by           UUID,                          -- auth.uid() of the creator
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_company_id   ON tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date     ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status       ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority     ON tasks(priority);

-- RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select tasks from their company"
  ON tasks FOR SELECT
  USING (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can insert tasks for their company"
  ON tasks FOR INSERT
  WITH CHECK (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can update tasks in their company"
  ON tasks FOR UPDATE
  USING (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can delete tasks in their company"
  ON tasks FOR DELETE
  USING (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  );

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION update_tasks_timestamp()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_update_timestamp
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_tasks_timestamp();


-- ── 2. INVENTORY ITEMS ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  location_id      UUID        REFERENCES locations(id) ON DELETE SET NULL,
  name             TEXT        NOT NULL,
  category         TEXT,
  sku              TEXT,
  unit             TEXT        NOT NULL DEFAULT 'units',
  current_quantity NUMERIC     NOT NULL DEFAULT 0,
  minimum_quantity NUMERIC     NOT NULL DEFAULT 0,
  unit_cost        NUMERIC     NOT NULL DEFAULT 0,
  status           TEXT        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'inactive', 'discontinued')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_company_id ON inventory_items(company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_name       ON inventory_items(name);
CREATE INDEX IF NOT EXISTS idx_inventory_items_status     ON inventory_items(status);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select inventory from their company"
  ON inventory_items FOR SELECT
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert inventory for their company"
  ON inventory_items FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update inventory in their company"
  ON inventory_items FOR UPDATE
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete inventory in their company"
  ON inventory_items FOR DELETE
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE OR REPLACE FUNCTION update_inventory_timestamp()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER inventory_items_update_timestamp
  BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION update_inventory_timestamp();


-- ── 3. INVENTORY MOVEMENTS ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_movements (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  inventory_item_id UUID        NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  movement_type     TEXT        NOT NULL
                                CHECK (movement_type IN ('purchase', 'usage', 'waste', 'adjustment', 'transfer')),
  quantity          NUMERIC     NOT NULL,             -- positive = in, negative = out for usage/waste
  unit_cost         NUMERIC,
  reason            TEXT,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_movements_company_id  ON inventory_movements(company_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_item_id     ON inventory_movements(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_created_at  ON inventory_movements(created_at DESC);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select movements from their company"
  ON inventory_movements FOR SELECT
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert movements for their company"
  ON inventory_movements FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

-- Trigger: auto-update current_quantity on inventory_items when a movement is inserted
CREATE OR REPLACE FUNCTION apply_inventory_movement()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  delta NUMERIC;
BEGIN
  -- For usage and waste, subtract. For purchase and adjustment, add (can be negative for adjustment).
  -- The quantity stored in the row is always the raw absolute amount.
  IF NEW.movement_type IN ('usage', 'waste') THEN
    delta := -ABS(NEW.quantity);
  ELSE
    delta := NEW.quantity;
  END IF;
  UPDATE inventory_items
  SET current_quantity = current_quantity + delta
  WHERE id = NEW.inventory_item_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_movement_apply
  AFTER INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION apply_inventory_movement();


-- ── 4. CUSTOMERS ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  first_name   TEXT        NOT NULL,
  last_name    TEXT,
  phone        TEXT,
  email        TEXT,
  birthday     DATE,
  vip_status   TEXT        NOT NULL DEFAULT 'standard'
               CHECK (vip_status IN ('standard', 'silver', 'gold', 'platinum')),
  total_visits INTEGER     NOT NULL DEFAULT 0,
  total_spend  NUMERIC     NOT NULL DEFAULT 0,
  last_visit_at TIMESTAMPTZ,
  preferences  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_company_id  ON customers(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_vip_status  ON customers(vip_status);
CREATE INDEX IF NOT EXISTS idx_customers_last_visit  ON customers(last_visit_at);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select customers from their company"
  ON customers FOR SELECT
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert customers for their company"
  ON customers FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update customers in their company"
  ON customers FOR UPDATE
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE OR REPLACE FUNCTION update_customers_timestamp()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER customers_update_timestamp
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_customers_timestamp();


-- ── 5. CUSTOMER INTERACTIONS ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_interactions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id      UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  interaction_type TEXT        NOT NULL
                               CHECK (interaction_type IN ('visit', 'reservation', 'complaint', 'compliment', 'no_show', 'message')),
  description      TEXT,
  value            NUMERIC,    -- spend value for visits
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interactions_company_id  ON customer_interactions(company_id);
CREATE INDEX IF NOT EXISTS idx_interactions_customer_id ON customer_interactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_interactions_occurred_at ON customer_interactions(occurred_at DESC);

ALTER TABLE customer_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select interactions from their company"
  ON customer_interactions FOR SELECT
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert interactions for their company"
  ON customer_interactions FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

-- Trigger: update customer total_visits and last_visit_at on each 'visit' interaction
CREATE OR REPLACE FUNCTION update_customer_visit_stats()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.interaction_type = 'visit' THEN
    UPDATE customers
    SET
      total_visits  = total_visits + 1,
      total_spend   = total_spend + COALESCE(NEW.value, 0),
      last_visit_at = NEW.occurred_at
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER customer_interaction_visit_stats
  AFTER INSERT ON customer_interactions
  FOR EACH ROW EXECUTE FUNCTION update_customer_visit_stats();


-- ── 6. BRAIN SCORE SNAPSHOTS ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brain_score_snapshots (
  id                UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  total_score       NUMERIC   NOT NULL,
  operations_score  NUMERIC   NOT NULL,
  employees_score   NUMERIC   NOT NULL,
  inventory_score   NUMERIC   NOT NULL,
  customers_score   NUMERIC   NOT NULL,
  data_quality_score NUMERIC  NOT NULL,
  metrics           JSONB     NOT NULL,
  calculated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_snapshots_company_id    ON brain_score_snapshots(company_id);
CREATE INDEX IF NOT EXISTS idx_brain_snapshots_calculated_at ON brain_score_snapshots(calculated_at DESC);

ALTER TABLE brain_score_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'brain_score_snapshots'
      AND policyname = 'Users can select brain scores from their company'
  ) THEN
    CREATE POLICY "Users can select brain scores from their company"
      ON brain_score_snapshots FOR SELECT
      USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'brain_score_snapshots'
      AND policyname = 'Users can create brain scores for their company'
  ) THEN
    CREATE POLICY "Users can create brain scores for their company"
      ON brain_score_snapshots FOR INSERT
      WITH CHECK (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;


-- ── 7. BUSINESS EVENTS ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS business_events (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  location_id        UUID        REFERENCES locations(id) ON DELETE SET NULL,
  event_type         TEXT        NOT NULL,
  module             TEXT        NOT NULL,
  title              TEXT        NOT NULL,
  description        TEXT,
  severity           TEXT,
  actor_user_id      UUID,
  employee_id        UUID        REFERENCES employees(id) ON DELETE SET NULL,
  customer_id        UUID        REFERENCES customers(id) ON DELETE SET NULL,
  task_id            UUID        REFERENCES tasks(id) ON DELETE SET NULL,
  inventory_item_id  UUID        REFERENCES inventory_items(id) ON DELETE SET NULL,
  metadata           JSONB       NOT NULL DEFAULT '{}',
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_events_company_id  ON business_events(company_id);
CREATE INDEX IF NOT EXISTS idx_business_events_occurred_at ON business_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_events_co_occ      ON business_events(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_events_event_type  ON business_events(event_type);
CREATE INDEX IF NOT EXISTS idx_business_events_module      ON business_events(module);

ALTER TABLE business_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'business_events'
      AND policyname = 'Users can select business events from their company'
  ) THEN
    CREATE POLICY "Users can select business events from their company"
      ON business_events FOR SELECT
      USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'business_events'
      AND policyname = 'Users can create business events for their company'
  ) THEN
    CREATE POLICY "Users can create business events for their company"
      ON business_events FOR INSERT
      WITH CHECK (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;


-- ── DONE ────────────────────────────────────────────────────────────────────
-- Verify by running:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   ORDER BY table_name;
