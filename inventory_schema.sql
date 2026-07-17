-- Inventory items table
CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  category TEXT,
  sku TEXT,
  unit TEXT DEFAULT 'units',
  current_quantity NUMERIC DEFAULT 0,
  minimum_quantity NUMERIC DEFAULT 0,
  unit_cost NUMERIC DEFAULT 0,
  supplier_id UUID,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'discontinued')),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Inventory movements table (audit trail of all stock changes)
CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('purchase', 'usage', 'waste', 'adjustment', 'transfer')),
  quantity NUMERIC NOT NULL,
  unit_cost NUMERIC,
  reason TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Indexes for inventory_items
CREATE INDEX IF NOT EXISTS idx_inventory_items_company_id ON inventory_items(company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_location_id ON inventory_items(location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category);
CREATE INDEX IF NOT EXISTS idx_inventory_items_status ON inventory_items(status);
CREATE INDEX IF NOT EXISTS idx_inventory_items_sku ON inventory_items(sku);

-- Indexes for inventory_movements
CREATE INDEX IF NOT EXISTS idx_inventory_movements_company_id ON inventory_movements(company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_id ON inventory_movements(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type ON inventory_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at ON inventory_movements(created_at DESC);

-- Row Level Security Policies for inventory_items
CREATE POLICY "Users can select inventory from their company"
  ON inventory_items FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can create inventory for their company"
  ON inventory_items FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update inventory in their company"
  ON inventory_items FOR UPDATE
  USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can delete inventory in their company"
  ON inventory_items FOR DELETE
  USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Row Level Security Policies for inventory_movements
CREATE POLICY "Users can select movements from their company"
  ON inventory_movements FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can record movements for their company"
  ON inventory_movements FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Enable RLS
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- Trigger to update inventory_items timestamp
CREATE OR REPLACE FUNCTION update_inventory_items_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_items_update_timestamp
BEFORE UPDATE ON inventory_items
FOR EACH ROW
EXECUTE FUNCTION update_inventory_items_timestamp();

-- Trigger to update inventory quantity when movement is recorded
-- This automatically updates the current_quantity based on movement_type
CREATE OR REPLACE FUNCTION apply_inventory_movement()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.movement_type = 'purchase' THEN
    UPDATE inventory_items
    SET current_quantity = current_quantity + NEW.quantity
    WHERE id = NEW.inventory_item_id;
  ELSIF NEW.movement_type IN ('usage', 'waste', 'transfer') THEN
    UPDATE inventory_items
    SET current_quantity = current_quantity - NEW.quantity
    WHERE id = NEW.inventory_item_id;
  ELSIF NEW.movement_type = 'adjustment' THEN
    -- Adjustment quantity is signed (can be positive or negative)
    UPDATE inventory_items
    SET current_quantity = current_quantity + NEW.quantity
    WHERE id = NEW.inventory_item_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER apply_inventory_movement_trigger
AFTER INSERT ON inventory_movements
FOR EACH ROW
EXECUTE FUNCTION apply_inventory_movement();
