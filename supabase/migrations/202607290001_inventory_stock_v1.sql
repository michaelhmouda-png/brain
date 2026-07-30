-- Inventory Stock V1: canonical catalog, storage, append-only ledger, balances,
-- physical counts, low-stock conditions, and focused authorization boundaries.
BEGIN;

CREATE TABLE public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name text NOT NULL,
  normalized_name text GENERATED ALWAYS AS (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) STORED,
  description text,
  category text NOT NULL,
  canonical_unit text NOT NULL,
  sku text,
  barcode text,
  status text NOT NULL DEFAULT 'active',
  default_low_stock_threshold numeric(18, 6),
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inventory_items_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT inventory_items_description_check CHECK (description IS NULL OR char_length(description) <= 2000),
  CONSTRAINT inventory_items_category_check CHECK (char_length(btrim(category)) BETWEEN 1 AND 80),
  CONSTRAINT inventory_items_unit_check CHECK (canonical_unit IN (
    'piece','bag','bottle','case','box','pack','kilogram','gram','litre','millilitre'
  )),
  CONSTRAINT inventory_items_sku_check CHECK (sku IS NULL OR char_length(btrim(sku)) BETWEEN 1 AND 80),
  CONSTRAINT inventory_items_barcode_check CHECK (barcode IS NULL OR barcode ~ '^[A-Za-z0-9._-]{3,128}$'),
  CONSTRAINT inventory_items_status_check CHECK (status IN ('active','inactive')),
  CONSTRAINT inventory_items_threshold_check CHECK (
    default_low_stock_threshold IS NULL OR default_low_stock_threshold >= 0
  ),
  CONSTRAINT inventory_items_company_id_id_key UNIQUE (company_id, id)
);

CREATE UNIQUE INDEX inventory_items_company_name_uidx
  ON public.inventory_items(company_id, normalized_name);
CREATE UNIQUE INDEX inventory_items_company_sku_uidx
  ON public.inventory_items(company_id, lower(btrim(sku))) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX inventory_items_company_barcode_uidx
  ON public.inventory_items(company_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX inventory_items_company_status_category_idx
  ON public.inventory_items(company_id, status, category, name);

CREATE TABLE public.inventory_storage_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  name text NOT NULL,
  normalized_name text GENERATED ALWAYS AS (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) STORED,
  description text,
  status text NOT NULL DEFAULT 'active',
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inventory_storage_areas_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT inventory_storage_areas_description_check CHECK (description IS NULL OR char_length(description) <= 1000),
  CONSTRAINT inventory_storage_areas_status_check CHECK (status IN ('active','inactive')),
  CONSTRAINT inventory_storage_areas_company_location_id_key UNIQUE (company_id, location_id, id)
);

CREATE UNIQUE INDEX inventory_storage_areas_location_name_uidx
  ON public.inventory_storage_areas(company_id, location_id, normalized_name);
CREATE INDEX inventory_storage_areas_company_location_status_idx
  ON public.inventory_storage_areas(company_id, location_id, status, name);

CREATE TABLE public.inventory_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  operation_type text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  correlation_id uuid NOT NULL,
  count_session_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inventory_operations_type_check CHECK (operation_type IN (
    'opening_balance','receipt','usage','waste','transfer',
    'adjustment_increase','adjustment_decrease','count_approval'
  )),
  CONSTRAINT inventory_operations_hash_check CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT inventory_operations_company_key UNIQUE (company_id, idempotency_key),
  CONSTRAINT inventory_operations_company_id_id_key UNIQUE (company_id, id)
);

CREATE INDEX inventory_operations_company_created_idx
  ON public.inventory_operations(company_id, created_at DESC);

CREATE TABLE public.inventory_count_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  storage_area_id uuid NOT NULL REFERENCES public.inventory_storage_areas(id) ON DELETE RESTRICT,
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_employee_id uuid REFERENCES public.employees(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  counting_started_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  cancelled_at timestamptz,
  cancelled_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reconciliation_operation_id uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inventory_count_sessions_status_check CHECK (
    status IN ('draft','counting','submitted','approved','cancelled')
  ),
  CONSTRAINT inventory_count_sessions_notes_check CHECK (notes IS NULL OR char_length(notes) <= 2000),
  CONSTRAINT inventory_count_sessions_lifecycle_check CHECK (
    (status = 'draft' AND counting_started_at IS NULL AND submitted_at IS NULL AND approved_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'counting' AND counting_started_at IS NOT NULL AND submitted_at IS NULL AND approved_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'submitted' AND counting_started_at IS NOT NULL AND submitted_at IS NOT NULL AND approved_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'approved' AND counting_started_at IS NOT NULL AND submitted_at IS NOT NULL AND approved_at IS NOT NULL
        AND approved_by_profile_id IS NOT NULL AND reconciliation_operation_id IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by_profile_id IS NOT NULL AND approved_at IS NULL)
  ),
  CONSTRAINT inventory_count_sessions_company_id_id_key UNIQUE (company_id, id)
);

ALTER TABLE public.inventory_operations
  ADD CONSTRAINT inventory_operations_count_session_fkey
  FOREIGN KEY (count_session_id) REFERENCES public.inventory_count_sessions(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_count_sessions
  ADD CONSTRAINT inventory_count_sessions_reconciliation_operation_fkey
  FOREIGN KEY (reconciliation_operation_id) REFERENCES public.inventory_operations(id) ON DELETE RESTRICT;

CREATE INDEX inventory_count_sessions_management_idx
  ON public.inventory_count_sessions(company_id, location_id, status, created_at DESC);
CREATE INDEX inventory_count_sessions_employee_idx
  ON public.inventory_count_sessions(company_id, assigned_employee_id, status, created_at DESC)
  WHERE assigned_employee_id IS NOT NULL;

CREATE TABLE public.inventory_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES public.inventory_count_sessions(id) ON DELETE RESTRICT,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  canonical_unit_snapshot text NOT NULL,
  expected_quantity numeric(18, 6) NOT NULL,
  counted_quantity numeric(18, 6),
  damaged_quantity numeric(18, 6),
  note text,
  variance numeric(18, 6) GENERATED ALWAYS AS (
    CASE WHEN counted_quantity IS NULL THEN NULL ELSE counted_quantity - expected_quantity END
  ) STORED,
  updated_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inventory_count_lines_unit_check CHECK (canonical_unit_snapshot IN (
    'piece','bag','bottle','case','box','pack','kilogram','gram','litre','millilitre'
  )),
  CONSTRAINT inventory_count_lines_expected_check CHECK (expected_quantity >= 0),
  CONSTRAINT inventory_count_lines_counted_check CHECK (counted_quantity IS NULL OR counted_quantity >= 0),
  CONSTRAINT inventory_count_lines_damaged_check CHECK (
    damaged_quantity IS NULL
    OR (damaged_quantity >= 0 AND counted_quantity IS NOT NULL AND damaged_quantity <= counted_quantity)
  ),
  CONSTRAINT inventory_count_lines_note_check CHECK (note IS NULL OR char_length(note) <= 1000),
  CONSTRAINT inventory_count_lines_session_item_key UNIQUE (session_id, inventory_item_id)
);

CREATE INDEX inventory_count_lines_company_session_idx
  ON public.inventory_count_lines(company_id, session_id, inventory_item_id);

CREATE TABLE public.inventory_balances (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  storage_area_id uuid NOT NULL REFERENCES public.inventory_storage_areas(id) ON DELETE RESTRICT,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity numeric(18, 6) NOT NULL DEFAULT 0,
  canonical_unit text NOT NULL,
  last_movement_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, location_id, storage_area_id, inventory_item_id),
  CONSTRAINT inventory_balances_quantity_check CHECK (quantity >= 0),
  CONSTRAINT inventory_balances_unit_check CHECK (canonical_unit IN (
    'piece','bag','bottle','case','box','pack','kilogram','gram','litre','millilitre'
  )),
  CONSTRAINT inventory_balances_version_check CHECK (version >= 0)
);

CREATE INDEX inventory_balances_item_idx
  ON public.inventory_balances(company_id, inventory_item_id, location_id, storage_area_id);
CREATE INDEX inventory_balances_updated_idx
  ON public.inventory_balances(company_id, updated_at DESC);

CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  storage_area_id uuid NOT NULL REFERENCES public.inventory_storage_areas(id) ON DELETE RESTRICT,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES public.inventory_operations(id) ON DELETE RESTRICT,
  movement_type text NOT NULL,
  quantity_delta numeric(18, 6) NOT NULL,
  balance_after numeric(18, 6) NOT NULL,
  canonical_unit_snapshot text NOT NULL,
  reason text,
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  correlation_id uuid NOT NULL,
  count_session_id uuid REFERENCES public.inventory_count_sessions(id) ON DELETE RESTRICT,
  transfer_id uuid,
  source_type text,
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inventory_movements_type_check CHECK (movement_type IN (
    'opening_balance','receipt','usage','waste','transfer_out','transfer_in',
    'adjustment_increase','adjustment_decrease','count_reconciliation'
  )),
  CONSTRAINT inventory_movements_delta_check CHECK (quantity_delta <> 0),
  CONSTRAINT inventory_movements_direction_check CHECK (
    (movement_type IN ('opening_balance','receipt','transfer_in','adjustment_increase') AND quantity_delta > 0)
    OR (movement_type IN ('usage','waste','transfer_out','adjustment_decrease') AND quantity_delta < 0)
    OR movement_type = 'count_reconciliation'
  ),
  CONSTRAINT inventory_movements_balance_check CHECK (balance_after >= 0),
  CONSTRAINT inventory_movements_unit_check CHECK (canonical_unit_snapshot IN (
    'piece','bag','bottle','case','box','pack','kilogram','gram','litre','millilitre'
  )),
  CONSTRAINT inventory_movements_reason_check CHECK (reason IS NULL OR char_length(reason) <= 1000),
  CONSTRAINT inventory_movements_source_type_check CHECK (
    source_type IS NULL OR source_type IN ('manual','count_session','task_evidence','pos','recipe','supplier','integration')
  )
);

CREATE INDEX inventory_movements_ledger_idx
  ON public.inventory_movements(company_id, location_id, storage_area_id, inventory_item_id, created_at DESC, id);
CREATE INDEX inventory_movements_operation_idx
  ON public.inventory_movements(company_id, operation_id, created_at, id);
CREATE UNIQUE INDEX inventory_movements_transfer_pair_uidx
  ON public.inventory_movements(company_id, transfer_id, movement_type)
  WHERE transfer_id IS NOT NULL;
CREATE UNIQUE INDEX inventory_movements_count_reconciliation_uidx
  ON public.inventory_movements(count_session_id, inventory_item_id)
  WHERE movement_type = 'count_reconciliation';

CREATE TABLE public.inventory_low_stock_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  storage_area_id uuid NOT NULL REFERENCES public.inventory_storage_areas(id) ON DELETE RESTRICT,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  threshold numeric(18, 6) NOT NULL,
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inventory_low_stock_thresholds_value_check CHECK (threshold >= 0),
  CONSTRAINT inventory_low_stock_thresholds_scope_key UNIQUE (
    company_id, location_id, storage_area_id, inventory_item_id
  )
);

CREATE TABLE public.inventory_low_stock_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  storage_area_id uuid NOT NULL REFERENCES public.inventory_storage_areas(id) ON DELETE RESTRICT,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  threshold numeric(18, 6) NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  resolution_reason text,
  CONSTRAINT inventory_low_stock_conditions_threshold_check CHECK (threshold >= 0),
  CONSTRAINT inventory_low_stock_conditions_resolution_check CHECK (
    (resolved_at IS NULL AND resolution_reason IS NULL)
    OR (resolved_at IS NOT NULL AND resolution_reason IN ('recovered','threshold_removed','item_inactive','area_inactive'))
  )
);

CREATE UNIQUE INDEX inventory_low_stock_conditions_open_uidx
  ON public.inventory_low_stock_conditions(company_id, location_id, storage_area_id, inventory_item_id)
  WHERE resolved_at IS NULL;
CREATE INDEX inventory_low_stock_conditions_company_state_idx
  ON public.inventory_low_stock_conditions(company_id, resolved_at, opened_at DESC);

-- Every cross-table scope is revalidated independently of browser input.
CREATE OR REPLACE FUNCTION private.validate_inventory_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_company uuid;
  v_location uuid;
  v_row jsonb := to_jsonb(NEW);
  v_row_company uuid;
  v_row_location uuid;
  v_row_storage_area uuid;
  v_row_inventory_item uuid;
  v_row_session uuid;
BEGIN
  v_row_company := nullif(v_row ->> 'company_id', '')::uuid;
  v_row_location := nullif(v_row ->> 'location_id', '')::uuid;
  v_row_storage_area := nullif(v_row ->> 'storage_area_id', '')::uuid;
  v_row_inventory_item := nullif(v_row ->> 'inventory_item_id', '')::uuid;
  v_row_session := nullif(v_row ->> 'session_id', '')::uuid;

  IF v_row_location IS NOT NULL THEN
    SELECT location.company_id INTO v_company
    FROM public.locations AS location
    WHERE location.id = v_row_location AND location.status = 'active';
    IF v_company IS DISTINCT FROM v_row_company THEN
      RAISE EXCEPTION 'INVENTORY_LOCATION_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_row_storage_area IS NOT NULL THEN
    SELECT area.company_id, area.location_id INTO v_company, v_location
    FROM public.inventory_storage_areas AS area
    WHERE area.id = v_row_storage_area;
    IF v_company IS DISTINCT FROM v_row_company
       OR (v_row ? 'location_id' AND v_location IS DISTINCT FROM v_row_location) THEN
      RAISE EXCEPTION 'INVENTORY_STORAGE_AREA_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_row_inventory_item IS NOT NULL THEN
    SELECT item.company_id INTO v_company
    FROM public.inventory_items AS item WHERE item.id = v_row_inventory_item;
    IF v_company IS DISTINCT FROM v_row_company THEN
      RAISE EXCEPTION 'INVENTORY_ITEM_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_row_session IS NOT NULL THEN
    SELECT session.company_id INTO v_company
    FROM public.inventory_count_sessions AS session WHERE session.id = v_row_session;
    IF v_company IS DISTINCT FROM v_row_company THEN
      RAISE EXCEPTION 'INVENTORY_COUNT_SESSION_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER inventory_storage_areas_scope
  BEFORE INSERT OR UPDATE ON public.inventory_storage_areas
  FOR EACH ROW EXECUTE FUNCTION private.validate_inventory_scope();
CREATE TRIGGER inventory_count_sessions_scope
  BEFORE INSERT OR UPDATE ON public.inventory_count_sessions
  FOR EACH ROW EXECUTE FUNCTION private.validate_inventory_scope();
CREATE TRIGGER inventory_count_lines_scope
  BEFORE INSERT OR UPDATE ON public.inventory_count_lines
  FOR EACH ROW EXECUTE FUNCTION private.validate_inventory_scope();
CREATE TRIGGER inventory_balances_scope
  BEFORE INSERT OR UPDATE ON public.inventory_balances
  FOR EACH ROW EXECUTE FUNCTION private.validate_inventory_scope();
CREATE TRIGGER inventory_movements_scope
  BEFORE INSERT OR UPDATE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION private.validate_inventory_scope();
CREATE TRIGGER inventory_thresholds_scope
  BEFORE INSERT OR UPDATE ON public.inventory_low_stock_thresholds
  FOR EACH ROW EXECUTE FUNCTION private.validate_inventory_scope();
CREATE TRIGGER inventory_conditions_scope
  BEFORE INSERT OR UPDATE ON public.inventory_low_stock_conditions
  FOR EACH ROW EXECUTE FUNCTION private.validate_inventory_scope();

CREATE OR REPLACE FUNCTION private.reject_inventory_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'INVENTORY_HISTORY_IMMUTABLE' USING ERRCODE = '55000';
END
$function$;

CREATE TRIGGER inventory_movements_append_only
  BEFORE UPDATE OR DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION private.reject_inventory_history_mutation();
CREATE TRIGGER inventory_operations_append_only
  BEFORE UPDATE OR DELETE ON public.inventory_operations
  FOR EACH ROW EXECUTE FUNCTION private.reject_inventory_history_mutation();

CREATE OR REPLACE FUNCTION private.validate_inventory_item_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.created_by_profile_id IS DISTINCT FROM OLD.created_by_profile_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'INVENTORY_ITEM_CONTEXT_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF NEW.canonical_unit IS DISTINCT FROM OLD.canonical_unit
     AND EXISTS (
       SELECT 1 FROM public.inventory_movements AS movement
       WHERE movement.company_id = OLD.company_id
         AND movement.inventory_item_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'INVENTORY_ITEM_UNIT_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$function$;

CREATE TRIGGER inventory_items_validate_update
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION private.validate_inventory_item_update();

CREATE OR REPLACE FUNCTION private.validate_inventory_count_session_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.location_id IS DISTINCT FROM OLD.location_id
     OR NEW.storage_area_id IS DISTINCT FROM OLD.storage_area_id
     OR NEW.created_by_profile_id IS DISTINCT FROM OLD.created_by_profile_id
     OR NEW.assigned_employee_id IS DISTINCT FROM OLD.assigned_employee_id
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'INVENTORY_COUNT_SCOPE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('approved','cancelled') THEN
    RAISE EXCEPTION 'INVENTORY_COUNT_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'draft' AND NEW.status IN ('counting','cancelled'))
    OR (OLD.status = 'counting' AND NEW.status IN ('submitted','cancelled'))
    OR (OLD.status = 'submitted' AND NEW.status IN ('approved','cancelled'))
  ) THEN
    RAISE EXCEPTION 'INVENTORY_COUNT_TRANSITION_INVALID' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$function$;

CREATE TRIGGER inventory_count_sessions_validate_update
  BEFORE UPDATE ON public.inventory_count_sessions
  FOR EACH ROW EXECUTE FUNCTION private.validate_inventory_count_session_update();

CREATE OR REPLACE FUNCTION private.validate_inventory_count_line_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_status text;
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.inventory_item_id IS DISTINCT FROM OLD.inventory_item_id
     OR NEW.canonical_unit_snapshot IS DISTINCT FROM OLD.canonical_unit_snapshot
     OR NEW.expected_quantity IS DISTINCT FROM OLD.expected_quantity
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'INVENTORY_COUNT_LINE_CONTEXT_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  SELECT session.status INTO v_status
  FROM public.inventory_count_sessions AS session WHERE session.id = OLD.session_id;
  IF v_status <> 'counting' THEN
    RAISE EXCEPTION 'INVENTORY_COUNT_NOT_EDITABLE' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$function$;

CREATE TRIGGER inventory_count_lines_validate_update
  BEFORE UPDATE ON public.inventory_count_lines
  FOR EACH ROW EXECUTE FUNCTION private.validate_inventory_count_line_update();
CREATE TRIGGER inventory_count_lines_no_delete
  BEFORE DELETE ON public.inventory_count_lines
  FOR EACH ROW EXECUTE FUNCTION private.reject_inventory_history_mutation();

CREATE OR REPLACE FUNCTION private.assert_inventory_management(p_actor_profile_id uuid, p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = p_actor_profile_id
      AND profile.company_id = p_company_id
      AND profile.status = 'active'
      AND profile.role IN ('manager','owner','super_admin')
  ) THEN
    RAISE EXCEPTION 'INVENTORY_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION private.evaluate_inventory_low_stock(
  p_company_id uuid,
  p_location_id uuid,
  p_storage_area_id uuid,
  p_inventory_item_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_quantity numeric(18,6);
  v_threshold numeric(18,6);
  v_condition_id uuid;
  v_item_status text;
  v_area_status text;
BEGIN
  SELECT coalesce(balance.quantity, 0),
         coalesce(threshold.threshold, item.default_low_stock_threshold),
         item.status,
         area.status
    INTO v_quantity, v_threshold, v_item_status, v_area_status
  FROM public.inventory_items AS item
  JOIN public.inventory_storage_areas AS area
    ON area.id = p_storage_area_id
   AND area.company_id = item.company_id
   AND area.location_id = p_location_id
  JOIN public.locations AS location
    ON location.id = area.location_id
   AND location.company_id = area.company_id
  LEFT JOIN public.inventory_balances AS balance
    ON balance.company_id = item.company_id
   AND balance.location_id = area.location_id
   AND balance.storage_area_id = area.id
   AND balance.inventory_item_id = item.id
  LEFT JOIN public.inventory_low_stock_thresholds AS threshold
    ON threshold.company_id = item.company_id
   AND threshold.location_id = area.location_id
   AND threshold.storage_area_id = area.id
   AND threshold.inventory_item_id = item.id
  WHERE item.company_id = p_company_id
    AND item.id = p_inventory_item_id
    AND location.status = 'active';

  IF v_item_status = 'active' AND v_area_status = 'active'
     AND v_threshold IS NOT NULL AND v_quantity < v_threshold THEN
    INSERT INTO public.inventory_low_stock_conditions (
      company_id, location_id, storage_area_id, inventory_item_id, threshold
    ) VALUES (
      p_company_id, p_location_id, p_storage_area_id, p_inventory_item_id, v_threshold
    )
    ON CONFLICT (company_id, location_id, storage_area_id, inventory_item_id)
      WHERE resolved_at IS NULL
    DO UPDATE SET threshold = EXCLUDED.threshold, last_evaluated_at = clock_timestamp()
    RETURNING id INTO v_condition_id;

    INSERT INTO public.notification_outbox (
      company_id, event_key, event_type, aggregate_type, aggregate_id
    ) VALUES (
      p_company_id,
      'inventory.low_stock:' || v_condition_id::text,
      'inventory.low_stock',
      'inventory_low_stock_condition',
      v_condition_id
    )
    ON CONFLICT (company_id, event_key) DO NOTHING;
  ELSE
    UPDATE public.inventory_low_stock_conditions AS condition
    SET resolved_at = clock_timestamp(),
        resolution_reason = CASE
          WHEN v_item_status = 'inactive' THEN 'item_inactive'
          WHEN v_area_status = 'inactive' THEN 'area_inactive'
          WHEN v_threshold IS NULL THEN 'threshold_removed'
          ELSE 'recovered'
        END,
        last_evaluated_at = clock_timestamp()
    WHERE condition.company_id = p_company_id
      AND condition.location_id = p_location_id
      AND condition.storage_area_id = p_storage_area_id
      AND condition.inventory_item_id = p_inventory_item_id
      AND condition.resolved_at IS NULL;
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.create_inventory_item(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_name text,
  p_description text,
  p_category text,
  p_canonical_unit text,
  p_sku text,
  p_barcode text,
  p_default_low_stock_threshold numeric
)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_item public.inventory_items%ROWTYPE;
  v_area record;
BEGIN
  PERFORM private.assert_inventory_management(p_actor_profile_id, p_company_id);
  INSERT INTO public.inventory_items (
    company_id,name,description,category,canonical_unit,sku,barcode,
    default_low_stock_threshold,created_by_profile_id
  ) VALUES (
    p_company_id,btrim(p_name),nullif(btrim(p_description),''),
    btrim(p_category),p_canonical_unit,nullif(btrim(p_sku),''),
    nullif(btrim(p_barcode),''),p_default_low_stock_threshold,p_actor_profile_id
  ) RETURNING * INTO v_item;
  FOR v_area IN
    SELECT area.location_id,area.id AS storage_area_id
    FROM public.inventory_storage_areas AS area
    WHERE area.company_id=p_company_id
  LOOP
    PERFORM private.evaluate_inventory_low_stock(
      p_company_id,v_area.location_id,v_area.storage_area_id,v_item.id
    );
  END LOOP;
  RETURN v_item;
END
$function$;

CREATE OR REPLACE FUNCTION public.update_inventory_item(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_item_id uuid,
  p_name text,
  p_description text,
  p_category text,
  p_canonical_unit text,
  p_sku text,
  p_barcode text,
  p_status text,
  p_default_low_stock_threshold numeric
)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_item public.inventory_items%ROWTYPE;
  v_area record;
BEGIN
  PERFORM private.assert_inventory_management(p_actor_profile_id, p_company_id);
  SELECT * INTO v_item FROM public.inventory_items AS item
  WHERE item.id = p_item_id AND item.company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_ITEM_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  UPDATE public.inventory_items AS item SET
    name=btrim(p_name),description=nullif(btrim(p_description),''),
    category=btrim(p_category),canonical_unit=p_canonical_unit,
    sku=nullif(btrim(p_sku),''),barcode=nullif(btrim(p_barcode),''),
    status=p_status,default_low_stock_threshold=p_default_low_stock_threshold
  WHERE item.id=p_item_id RETURNING * INTO v_item;
  IF v_item.status = 'inactive' THEN
    UPDATE public.inventory_low_stock_conditions AS condition
    SET resolved_at=clock_timestamp(),resolution_reason='item_inactive',
        last_evaluated_at=clock_timestamp()
    WHERE condition.company_id=p_company_id AND condition.inventory_item_id=p_item_id
      AND condition.resolved_at IS NULL;
  END IF;
  FOR v_area IN
    SELECT area.location_id,area.id AS storage_area_id
    FROM public.inventory_storage_areas AS area
    WHERE area.company_id=p_company_id
  LOOP
    PERFORM private.evaluate_inventory_low_stock(
      p_company_id,v_area.location_id,v_area.storage_area_id,p_item_id
    );
  END LOOP;
  RETURN v_item;
END
$function$;

CREATE OR REPLACE FUNCTION public.create_inventory_storage_area(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_location_id uuid,
  p_name text,
  p_description text
)
RETURNS public.inventory_storage_areas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_area public.inventory_storage_areas%ROWTYPE;
  v_item record;
BEGIN
  PERFORM private.assert_inventory_management(p_actor_profile_id, p_company_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.locations AS location
    WHERE location.id=p_location_id AND location.company_id=p_company_id AND location.status='active'
  ) THEN RAISE EXCEPTION 'INVENTORY_LOCATION_INVALID' USING ERRCODE='23514'; END IF;
  INSERT INTO public.inventory_storage_areas (
    company_id,location_id,name,description,created_by_profile_id
  ) VALUES (
    p_company_id,p_location_id,btrim(p_name),nullif(btrim(p_description),''),p_actor_profile_id
  ) RETURNING * INTO v_area;
  FOR v_item IN
    SELECT item.id FROM public.inventory_items AS item
    WHERE item.company_id=p_company_id AND item.status='active'
  LOOP
    PERFORM private.evaluate_inventory_low_stock(
      p_company_id,p_location_id,v_area.id,v_item.id
    );
  END LOOP;
  RETURN v_area;
END
$function$;

CREATE OR REPLACE FUNCTION public.set_inventory_storage_area_status(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_storage_area_id uuid,
  p_status text
)
RETURNS public.inventory_storage_areas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_area public.inventory_storage_areas%ROWTYPE;
BEGIN
  PERFORM private.assert_inventory_management(p_actor_profile_id,p_company_id);
  UPDATE public.inventory_storage_areas AS area
  SET status=p_status,updated_at=clock_timestamp()
  WHERE area.id=p_storage_area_id AND area.company_id=p_company_id
  RETURNING * INTO v_area;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_STORAGE_AREA_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_area.status = 'inactive' THEN
    UPDATE public.inventory_low_stock_conditions AS condition
    SET resolved_at=clock_timestamp(),resolution_reason='area_inactive',
        last_evaluated_at=clock_timestamp()
    WHERE condition.company_id=p_company_id AND condition.storage_area_id=p_storage_area_id
      AND condition.resolved_at IS NULL;
  END IF;
  RETURN v_area;
END
$function$;

CREATE OR REPLACE FUNCTION public.record_inventory_movement(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_location_id uuid,
  p_storage_area_id uuid,
  p_inventory_item_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_reason text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_correlation_id uuid,
  p_source_type text DEFAULT 'manual',
  p_source_id uuid DEFAULT NULL
)
RETURNS TABLE(operation_id uuid, movement_id uuid, balance_quantity numeric, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_item public.inventory_items%ROWTYPE;
  v_area public.inventory_storage_areas%ROWTYPE;
  v_operation public.inventory_operations%ROWTYPE;
  v_delta numeric(18,6);
  v_balance numeric(18,6);
  v_movement_id uuid;
BEGIN
  PERFORM private.assert_inventory_management(p_actor_profile_id,p_company_id);
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 999999999999::numeric
     OR p_movement_type NOT IN (
       'opening_balance','receipt','usage','waste','adjustment_increase','adjustment_decrease'
     ) OR p_idempotency_key IS NULL OR p_request_hash IS NULL
     OR p_request_hash !~ '^[a-f0-9]{64}$'
     OR (p_reason IS NOT NULL AND char_length(p_reason)>1000) THEN
    RAISE EXCEPTION 'INVENTORY_INPUT_INVALID' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_operation FROM public.inventory_operations AS operation
  WHERE operation.company_id=p_company_id AND operation.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_operation.request_hash IS DISTINCT FROM p_request_hash
       OR v_operation.operation_type IS DISTINCT FROM p_movement_type THEN
      RAISE EXCEPTION 'INVENTORY_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505';
    END IF;
    RETURN QUERY
    SELECT v_operation.id,movement.id,movement.balance_after,true
    FROM public.inventory_movements AS movement
    WHERE movement.operation_id=v_operation.id ORDER BY movement.created_at,movement.id LIMIT 1;
    RETURN;
  END IF;

  SELECT * INTO v_item FROM public.inventory_items AS item
  WHERE item.id=p_inventory_item_id AND item.company_id=p_company_id AND item.status='active';
  SELECT * INTO v_area FROM public.inventory_storage_areas AS area
  WHERE area.id=p_storage_area_id AND area.company_id=p_company_id
    AND area.location_id=p_location_id AND area.status='active';
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'INVENTORY_ITEM_INVALID' USING ERRCODE='23514'; END IF;
  IF v_area.id IS NULL THEN RAISE EXCEPTION 'INVENTORY_STORAGE_AREA_INVALID' USING ERRCODE='23514'; END IF;

  INSERT INTO public.inventory_balances (
    company_id,location_id,storage_area_id,inventory_item_id,canonical_unit
  ) VALUES (
    p_company_id,p_location_id,p_storage_area_id,p_inventory_item_id,v_item.canonical_unit
  ) ON CONFLICT DO NOTHING;

  SELECT balance.quantity INTO v_balance
  FROM public.inventory_balances AS balance
  WHERE balance.company_id=p_company_id AND balance.location_id=p_location_id
    AND balance.storage_area_id=p_storage_area_id AND balance.inventory_item_id=p_inventory_item_id
  FOR UPDATE;

  IF p_movement_type='opening_balance' AND EXISTS (
    SELECT 1 FROM public.inventory_movements AS movement
    WHERE movement.company_id=p_company_id
      AND movement.location_id=p_location_id
      AND movement.storage_area_id=p_storage_area_id
      AND movement.inventory_item_id=p_inventory_item_id
  ) THEN
    RAISE EXCEPTION 'INVENTORY_OPENING_BALANCE_EXISTS' USING ERRCODE='23505';
  END IF;

  v_delta := CASE
    WHEN p_movement_type IN ('opening_balance','receipt','adjustment_increase') THEN p_quantity
    ELSE -p_quantity
  END;
  IF v_balance + v_delta < 0 THEN
    RAISE EXCEPTION 'INVENTORY_INSUFFICIENT_STOCK' USING ERRCODE='23514';
  END IF;

  INSERT INTO public.inventory_operations (
    company_id,operation_type,idempotency_key,request_hash,actor_profile_id,correlation_id
  ) VALUES (
    p_company_id,p_movement_type,p_idempotency_key,p_request_hash,p_actor_profile_id,p_correlation_id
  ) RETURNING * INTO v_operation;

  UPDATE public.inventory_balances AS balance SET
    quantity=v_balance+v_delta,canonical_unit=v_item.canonical_unit,
    last_movement_at=clock_timestamp(),updated_at=clock_timestamp(),version=balance.version+1
  WHERE balance.company_id=p_company_id AND balance.location_id=p_location_id
    AND balance.storage_area_id=p_storage_area_id AND balance.inventory_item_id=p_inventory_item_id;

  INSERT INTO public.inventory_movements (
    company_id,location_id,storage_area_id,inventory_item_id,operation_id,
    movement_type,quantity_delta,balance_after,canonical_unit_snapshot,reason,
    actor_profile_id,correlation_id,source_type,source_id
  ) VALUES (
    p_company_id,p_location_id,p_storage_area_id,p_inventory_item_id,v_operation.id,
    p_movement_type,v_delta,v_balance+v_delta,v_item.canonical_unit,nullif(btrim(p_reason),''),
    p_actor_profile_id,p_correlation_id,p_source_type,p_source_id
  ) RETURNING id INTO v_movement_id;

  PERFORM private.evaluate_inventory_low_stock(
    p_company_id,p_location_id,p_storage_area_id,p_inventory_item_id
  );
  RETURN QUERY SELECT v_operation.id,v_movement_id,v_balance+v_delta,false;
END
$function$;

CREATE OR REPLACE FUNCTION public.transfer_inventory_stock(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_location_id uuid,
  p_source_storage_area_id uuid,
  p_destination_storage_area_id uuid,
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_reason text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_correlation_id uuid
)
RETURNS TABLE(operation_id uuid, transfer_id uuid, source_balance numeric, destination_balance numeric, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_item public.inventory_items%ROWTYPE;
  v_operation public.inventory_operations%ROWTYPE;
  v_transfer_id uuid;
  v_source numeric(18,6);
  v_destination numeric(18,6);
BEGIN
  PERFORM private.assert_inventory_management(p_actor_profile_id,p_company_id);
  IF p_source_storage_area_id=p_destination_storage_area_id OR p_quantity IS NULL OR p_quantity<=0
     OR p_idempotency_key IS NULL OR p_request_hash IS NULL
     OR p_request_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVENTORY_TRANSFER_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_operation FROM public.inventory_operations AS operation
  WHERE operation.company_id=p_company_id AND operation.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_operation.request_hash<>p_request_hash OR v_operation.operation_type<>'transfer' THEN
      RAISE EXCEPTION 'INVENTORY_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505';
    END IF;
    RETURN QUERY
    SELECT v_operation.id,movement.transfer_id,
      max(movement.balance_after) FILTER (WHERE movement.movement_type='transfer_out'),
      max(movement.balance_after) FILTER (WHERE movement.movement_type='transfer_in'),true
    FROM public.inventory_movements AS movement WHERE movement.operation_id=v_operation.id
    GROUP BY movement.transfer_id;
    RETURN;
  END IF;
  SELECT * INTO v_item FROM public.inventory_items AS item
  WHERE item.id=p_inventory_item_id AND item.company_id=p_company_id AND item.status='active';
  IF v_item.id IS NULL OR (
    SELECT count(*) FROM public.inventory_storage_areas AS area
    WHERE area.company_id=p_company_id AND area.location_id=p_location_id AND area.status='active'
      AND area.id IN (p_source_storage_area_id,p_destination_storage_area_id)
  )<>2 THEN RAISE EXCEPTION 'INVENTORY_TRANSFER_SCOPE_INVALID' USING ERRCODE='23514'; END IF;

  INSERT INTO public.inventory_balances(company_id,location_id,storage_area_id,inventory_item_id,canonical_unit)
  VALUES
    (p_company_id,p_location_id,p_source_storage_area_id,p_inventory_item_id,v_item.canonical_unit),
    (p_company_id,p_location_id,p_destination_storage_area_id,p_inventory_item_id,v_item.canonical_unit)
  ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.inventory_balances AS balance
  WHERE balance.company_id=p_company_id AND balance.location_id=p_location_id
    AND balance.inventory_item_id=p_inventory_item_id
    AND balance.storage_area_id IN (p_source_storage_area_id,p_destination_storage_area_id)
  ORDER BY balance.storage_area_id FOR UPDATE;
  SELECT quantity INTO v_source FROM public.inventory_balances
  WHERE company_id=p_company_id AND location_id=p_location_id
    AND storage_area_id=p_source_storage_area_id AND inventory_item_id=p_inventory_item_id;
  SELECT quantity INTO v_destination FROM public.inventory_balances
  WHERE company_id=p_company_id AND location_id=p_location_id
    AND storage_area_id=p_destination_storage_area_id AND inventory_item_id=p_inventory_item_id;
  IF v_source<p_quantity THEN RAISE EXCEPTION 'INVENTORY_INSUFFICIENT_STOCK' USING ERRCODE='23514'; END IF;

  INSERT INTO public.inventory_operations(
    company_id,operation_type,idempotency_key,request_hash,actor_profile_id,correlation_id
  ) VALUES (
    p_company_id,'transfer',p_idempotency_key,p_request_hash,p_actor_profile_id,p_correlation_id
  ) RETURNING * INTO v_operation;
  v_transfer_id:=v_operation.id;

  UPDATE public.inventory_balances AS balance SET
    quantity=CASE WHEN balance.storage_area_id=p_source_storage_area_id
      THEN v_source-p_quantity ELSE v_destination+p_quantity END,
    last_movement_at=clock_timestamp(),updated_at=clock_timestamp(),version=balance.version+1
  WHERE balance.company_id=p_company_id AND balance.location_id=p_location_id
    AND balance.inventory_item_id=p_inventory_item_id
    AND balance.storage_area_id IN (p_source_storage_area_id,p_destination_storage_area_id);

  INSERT INTO public.inventory_movements(
    company_id,location_id,storage_area_id,inventory_item_id,operation_id,movement_type,
    quantity_delta,balance_after,canonical_unit_snapshot,reason,actor_profile_id,
    correlation_id,transfer_id,source_type
  ) VALUES
    (p_company_id,p_location_id,p_source_storage_area_id,p_inventory_item_id,v_operation.id,
     'transfer_out',-p_quantity,v_source-p_quantity,v_item.canonical_unit,nullif(btrim(p_reason),''),
     p_actor_profile_id,p_correlation_id,v_transfer_id,'manual'),
    (p_company_id,p_location_id,p_destination_storage_area_id,p_inventory_item_id,v_operation.id,
     'transfer_in',p_quantity,v_destination+p_quantity,v_item.canonical_unit,nullif(btrim(p_reason),''),
     p_actor_profile_id,p_correlation_id,v_transfer_id,'manual');
  PERFORM private.evaluate_inventory_low_stock(p_company_id,p_location_id,p_source_storage_area_id,p_inventory_item_id);
  PERFORM private.evaluate_inventory_low_stock(p_company_id,p_location_id,p_destination_storage_area_id,p_inventory_item_id);
  RETURN QUERY SELECT v_operation.id,v_transfer_id,v_source-p_quantity,v_destination+p_quantity,false;
END
$function$;

CREATE OR REPLACE FUNCTION public.create_inventory_count_session(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_location_id uuid,
  p_storage_area_id uuid,
  p_assigned_employee_id uuid,
  p_notes text,
  p_correlation_id uuid
)
RETURNS public.inventory_count_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_session public.inventory_count_sessions%ROWTYPE;
BEGIN
  PERFORM private.assert_inventory_management(p_actor_profile_id,p_company_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_storage_areas AS area
    JOIN public.locations AS location ON location.id=area.location_id
    WHERE area.id=p_storage_area_id AND area.company_id=p_company_id
      AND area.location_id=p_location_id AND area.status='active' AND location.status='active'
  ) OR (p_assigned_employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.employees AS employee
    WHERE employee.id=p_assigned_employee_id AND employee.company_id=p_company_id
      AND employee.location_id=p_location_id AND employee.status='active'
  )) THEN RAISE EXCEPTION 'INVENTORY_COUNT_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
  INSERT INTO public.inventory_count_sessions(
    company_id,location_id,storage_area_id,created_by_profile_id,
    assigned_employee_id,notes,correlation_id
  ) VALUES (
    p_company_id,p_location_id,p_storage_area_id,p_actor_profile_id,
    p_assigned_employee_id,nullif(btrim(p_notes),''),p_correlation_id
  ) RETURNING * INTO v_session;
  INSERT INTO public.inventory_count_lines(
    company_id,session_id,inventory_item_id,canonical_unit_snapshot,expected_quantity
  )
  SELECT p_company_id,v_session.id,item.id,item.canonical_unit,coalesce(balance.quantity,0)
  FROM public.inventory_items AS item
  LEFT JOIN public.inventory_balances AS balance
    ON balance.company_id=item.company_id AND balance.inventory_item_id=item.id
   AND balance.location_id=p_location_id AND balance.storage_area_id=p_storage_area_id
  WHERE item.company_id=p_company_id AND item.status='active'
  ORDER BY item.name;
  RETURN v_session;
END
$function$;

CREATE OR REPLACE FUNCTION public.update_inventory_count(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_session_id uuid,
  p_action text,
  p_lines jsonb DEFAULT NULL
)
RETURNS public.inventory_count_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_session public.inventory_count_sessions%ROWTYPE;
  v_line jsonb;
BEGIN
  SELECT * INTO v_profile FROM public.profiles AS profile
  WHERE profile.id=p_actor_profile_id AND profile.company_id=p_company_id AND profile.status='active';
  SELECT * INTO v_session FROM public.inventory_count_sessions AS session
  WHERE session.id=p_session_id AND session.company_id=p_company_id FOR UPDATE;
  IF v_profile.id IS NULL OR v_session.id IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_COUNT_NOT_FOUND' USING ERRCODE='P0002';
  END IF;
  IF v_profile.role='employee' THEN
    IF v_profile.employee_id IS NULL OR v_session.assigned_employee_id<>v_profile.employee_id THEN
      RAISE EXCEPTION 'INVENTORY_COUNT_FORBIDDEN' USING ERRCODE='42501';
    END IF;
  ELSIF v_profile.role NOT IN ('manager','owner','super_admin') THEN
    RAISE EXCEPTION 'INVENTORY_COUNT_FORBIDDEN' USING ERRCODE='42501';
  END IF;

  IF p_action='start' THEN
    IF v_session.status<>'draft' THEN RAISE EXCEPTION 'INVENTORY_COUNT_TRANSITION_INVALID' USING ERRCODE='23514'; END IF;
    UPDATE public.inventory_count_sessions SET status='counting',counting_started_at=clock_timestamp()
    WHERE id=p_session_id RETURNING * INTO v_session;
  ELSIF p_action='save' THEN
    IF v_session.status<>'counting' OR jsonb_typeof(p_lines)<>'array' THEN
      RAISE EXCEPTION 'INVENTORY_COUNT_NOT_EDITABLE' USING ERRCODE='55000';
    END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
      IF (v_line->>'countedQuantity') IS NULL
         OR (v_line->>'countedQuantity')::numeric<0
         OR coalesce((v_line->>'damagedQuantity')::numeric,0)<0 THEN
        RAISE EXCEPTION 'INVENTORY_COUNT_LINE_INVALID' USING ERRCODE='22023';
      END IF;
      UPDATE public.inventory_count_lines AS line SET
        counted_quantity=(v_line->>'countedQuantity')::numeric,
        damaged_quantity=(v_line->>'damagedQuantity')::numeric,
        note=nullif(btrim(v_line->>'note'),''),
        updated_by_profile_id=p_actor_profile_id
      WHERE line.id=(v_line->>'lineId')::uuid AND line.session_id=p_session_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_COUNT_LINE_INVALID' USING ERRCODE='22023'; END IF;
    END LOOP;
    SELECT * INTO v_session FROM public.inventory_count_sessions WHERE id=p_session_id;
  ELSIF p_action='submit' THEN
    IF v_session.status<>'counting' OR EXISTS(
      SELECT 1 FROM public.inventory_count_lines AS line
      WHERE line.session_id=p_session_id AND line.counted_quantity IS NULL
    ) THEN RAISE EXCEPTION 'INVENTORY_COUNT_INCOMPLETE' USING ERRCODE='23514'; END IF;
    UPDATE public.inventory_count_sessions SET status='submitted',submitted_at=clock_timestamp()
    WHERE id=p_session_id RETURNING * INTO v_session;
  ELSIF p_action='cancel' THEN
    IF v_profile.role NOT IN ('manager','owner','super_admin') OR v_session.status NOT IN ('draft','counting','submitted') THEN
      RAISE EXCEPTION 'INVENTORY_COUNT_TRANSITION_INVALID' USING ERRCODE='23514';
    END IF;
    UPDATE public.inventory_count_sessions SET
      status='cancelled',cancelled_at=clock_timestamp(),cancelled_by_profile_id=p_actor_profile_id
    WHERE id=p_session_id RETURNING * INTO v_session;
  ELSE
    RAISE EXCEPTION 'INVENTORY_COUNT_ACTION_INVALID' USING ERRCODE='22023';
  END IF;
  RETURN v_session;
END
$function$;

CREATE OR REPLACE FUNCTION public.approve_inventory_count(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_session_id uuid,
  p_idempotency_key uuid,
  p_request_hash text,
  p_correlation_id uuid
)
RETURNS TABLE(session_id uuid, operation_id uuid, reconciliation_count integer, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_session public.inventory_count_sessions%ROWTYPE;
  v_operation public.inventory_operations%ROWTYPE;
  v_line record;
  v_current numeric(18,6);
  v_count integer:=0;
BEGIN
  PERFORM private.assert_inventory_management(p_actor_profile_id,p_company_id);
  SELECT * INTO v_session FROM public.inventory_count_sessions AS session
  WHERE session.id=p_session_id AND session.company_id=p_company_id FOR UPDATE;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'INVENTORY_COUNT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_session.status='approved' THEN
    RETURN QUERY SELECT v_session.id,v_session.reconciliation_operation_id,
      (SELECT count(*)::integer FROM public.inventory_movements AS movement
       WHERE movement.count_session_id=v_session.id AND movement.movement_type='count_reconciliation'),true;
    RETURN;
  END IF;
  IF v_session.status<>'submitted' OR p_idempotency_key IS NULL OR p_request_hash IS NULL
     OR p_request_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVENTORY_COUNT_APPROVAL_INVALID' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_operation FROM public.inventory_operations AS operation
  WHERE operation.company_id=p_company_id AND operation.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_operation.request_hash<>p_request_hash OR v_operation.count_session_id<>p_session_id THEN
      RAISE EXCEPTION 'INVENTORY_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505';
    END IF;
  ELSE
    INSERT INTO public.inventory_operations(
      company_id,operation_type,idempotency_key,request_hash,actor_profile_id,
      correlation_id,count_session_id
    ) VALUES (
      p_company_id,'count_approval',p_idempotency_key,p_request_hash,p_actor_profile_id,
      p_correlation_id,p_session_id
    ) RETURNING * INTO v_operation;
  END IF;

  FOR v_line IN
    SELECT line.*,item.status AS item_status
    FROM public.inventory_count_lines AS line
    JOIN public.inventory_items AS item ON item.id=line.inventory_item_id AND item.company_id=line.company_id
    WHERE line.session_id=p_session_id ORDER BY line.inventory_item_id FOR UPDATE OF line
  LOOP
    INSERT INTO public.inventory_balances(company_id,location_id,storage_area_id,inventory_item_id,canonical_unit)
    VALUES(p_company_id,v_session.location_id,v_session.storage_area_id,v_line.inventory_item_id,v_line.canonical_unit_snapshot)
    ON CONFLICT DO NOTHING;
    SELECT balance.quantity INTO v_current FROM public.inventory_balances AS balance
    WHERE balance.company_id=p_company_id AND balance.location_id=v_session.location_id
      AND balance.storage_area_id=v_session.storage_area_id
      AND balance.inventory_item_id=v_line.inventory_item_id FOR UPDATE;
    IF v_current IS DISTINCT FROM v_line.expected_quantity THEN
      RAISE EXCEPTION 'INVENTORY_COUNT_STALE' USING ERRCODE='40001';
    END IF;
    IF v_line.variance<>0 THEN
      UPDATE public.inventory_balances AS balance SET
        quantity=v_line.counted_quantity,last_movement_at=clock_timestamp(),
        updated_at=clock_timestamp(),version=balance.version+1
      WHERE balance.company_id=p_company_id AND balance.location_id=v_session.location_id
        AND balance.storage_area_id=v_session.storage_area_id
        AND balance.inventory_item_id=v_line.inventory_item_id;
      INSERT INTO public.inventory_movements(
        company_id,location_id,storage_area_id,inventory_item_id,operation_id,movement_type,
        quantity_delta,balance_after,canonical_unit_snapshot,reason,actor_profile_id,
        correlation_id,count_session_id,source_type,source_id
      ) VALUES(
        p_company_id,v_session.location_id,v_session.storage_area_id,v_line.inventory_item_id,
        v_operation.id,'count_reconciliation',v_line.variance,v_line.counted_quantity,
        v_line.canonical_unit_snapshot,'Approved physical stock count',p_actor_profile_id,
        p_correlation_id,p_session_id,'count_session',p_session_id
      );
      v_count:=v_count+1;
    END IF;
    PERFORM private.evaluate_inventory_low_stock(
      p_company_id,v_session.location_id,v_session.storage_area_id,v_line.inventory_item_id
    );
  END LOOP;
  UPDATE public.inventory_count_sessions SET
    status='approved',approved_at=clock_timestamp(),approved_by_profile_id=p_actor_profile_id,
    reconciliation_operation_id=v_operation.id
  WHERE id=p_session_id RETURNING * INTO v_session;
  RETURN QUERY SELECT v_session.id,v_operation.id,v_count,false;
END
$function$;

CREATE OR REPLACE FUNCTION public.set_inventory_low_stock_threshold(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_location_id uuid,
  p_storage_area_id uuid,
  p_inventory_item_id uuid,
  p_threshold numeric
)
RETURNS public.inventory_low_stock_thresholds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_threshold public.inventory_low_stock_thresholds%ROWTYPE;
BEGIN
  PERFORM private.assert_inventory_management(p_actor_profile_id,p_company_id);
  INSERT INTO public.inventory_low_stock_thresholds(
    company_id,location_id,storage_area_id,inventory_item_id,threshold,created_by_profile_id
  ) VALUES(
    p_company_id,p_location_id,p_storage_area_id,p_inventory_item_id,p_threshold,p_actor_profile_id
  )
  ON CONFLICT(company_id,location_id,storage_area_id,inventory_item_id)
  DO UPDATE SET threshold=EXCLUDED.threshold,updated_at=clock_timestamp()
  RETURNING * INTO v_threshold;
  PERFORM private.evaluate_inventory_low_stock(
    p_company_id,p_location_id,p_storage_area_id,p_inventory_item_id
  );
  RETURN v_threshold;
END
$function$;

-- Deterministic management read; quantities and low-stock state are database-owned.
CREATE OR REPLACE FUNCTION public.list_inventory_stock(
  p_location_id uuid DEFAULT NULL,
  p_storage_area_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_low_stock_only boolean DEFAULT false,
  p_limit integer DEFAULT 200
)
RETURNS TABLE(
  item_id uuid,item_name text,description text,category text,canonical_unit text,sku text,barcode text,
  item_status text,default_threshold numeric,location_id uuid,location_name text,
  storage_area_id uuid,storage_area_name text,storage_area_status text,
  quantity numeric,effective_threshold numeric,is_low_stock boolean,last_movement_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles AS profile
  WHERE profile.id=auth.uid() AND profile.status='active'
    AND profile.role IN ('manager','owner','super_admin');
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'INVENTORY_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'INVENTORY_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  SELECT item.id,item.name,item.description,item.category,item.canonical_unit,item.sku,item.barcode,
    item.status,item.default_low_stock_threshold,location.id,location.name,area.id,area.name,area.status,
    coalesce(balance.quantity,0),
    coalesce(threshold.threshold,item.default_low_stock_threshold),
    coalesce(threshold.threshold,item.default_low_stock_threshold) IS NOT NULL
      AND coalesce(balance.quantity,0)<coalesce(threshold.threshold,item.default_low_stock_threshold),
    balance.last_movement_at
  FROM public.inventory_items AS item
  JOIN public.inventory_storage_areas AS area ON area.company_id=item.company_id
  JOIN public.locations AS location ON location.id=area.location_id AND location.company_id=item.company_id
  LEFT JOIN public.inventory_balances AS balance
    ON balance.company_id=item.company_id AND balance.location_id=location.id
   AND balance.storage_area_id=area.id AND balance.inventory_item_id=item.id
  LEFT JOIN public.inventory_low_stock_thresholds AS threshold
    ON threshold.company_id=item.company_id AND threshold.location_id=location.id
   AND threshold.storage_area_id=area.id AND threshold.inventory_item_id=item.id
  WHERE item.company_id=v_profile.company_id
    AND (p_location_id IS NULL OR location.id=p_location_id)
    AND (p_storage_area_id IS NULL OR area.id=p_storage_area_id)
    AND (p_category IS NULL OR item.category=p_category)
    AND (p_search IS NULL OR item.name ILIKE '%'||replace(replace(p_search,'%',''),'_','')||'%'
      OR item.sku ILIKE '%'||replace(replace(p_search,'%',''),'_','')||'%'
      OR item.barcode ILIKE '%'||replace(replace(p_search,'%',''),'_','')||'%')
    AND (NOT p_low_stock_only OR (
      coalesce(threshold.threshold,item.default_low_stock_threshold) IS NOT NULL
      AND coalesce(balance.quantity,0)<coalesce(threshold.threshold,item.default_low_stock_threshold)
    ))
  ORDER BY location.name,area.name,item.name
  LIMIT p_limit;
END
$function$;

-- Inventory low-stock obligations are materialized by the existing worker.
CREATE OR REPLACE FUNCTION public.materialize_inventory_low_stock_outbox(
  p_outbox_id uuid,
  p_lease_token uuid
)
RETURNS TABLE(handled boolean, notification_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_outbox public.notification_outbox%ROWTYPE;
  v_recipient record;
  v_notification_id uuid;
  v_count integer:=0;
  v_in_app boolean;
BEGIN
  SELECT * INTO v_outbox FROM public.notification_outbox AS outbox
  WHERE outbox.id=p_outbox_id AND outbox.status='processing'
    AND outbox.lease_token=p_lease_token AND outbox.lease_expires_at>=clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED'; END IF;
  IF v_outbox.event_type<>'inventory.low_stock'
     OR v_outbox.aggregate_type<>'inventory_low_stock_condition' THEN
    RETURN QUERY SELECT false,0; RETURN;
  END IF;

  FOR v_recipient IN
    SELECT profile.id,
      coalesce(preference.in_app_enabled,true) AS in_app_enabled,
      coalesce(preference.push_enabled,false) AS push_enabled,
      preference.quiet_hours_enabled,preference.quiet_hours_start,
      preference.quiet_hours_end,preference.timezone
    FROM public.profiles AS profile
    LEFT JOIN public.notification_preferences AS preference ON preference.profile_id=profile.id
    WHERE profile.company_id=v_outbox.company_id AND profile.status='active'
      AND profile.role IN ('manager','owner','super_admin')
      AND EXISTS(
        SELECT 1 FROM public.inventory_low_stock_conditions AS condition
        WHERE condition.id=v_outbox.aggregate_id AND condition.company_id=v_outbox.company_id
          AND condition.resolved_at IS NULL
      )
  LOOP
    INSERT INTO public.notifications(
      company_id,recipient_id,title,message,notification_type,related_entity_type,
      related_entity_id,status,category,route,event_key,is_read
    ) VALUES(
      v_outbox.company_id,v_recipient.id,'Low stock needs attention',
      'Open HospiBrain Inventory to review the low-stock condition.',
      v_outbox.event_type,v_outbox.aggregate_type,v_outbox.aggregate_id,
      CASE WHEN v_recipient.in_app_enabled THEN 'unread' ELSE 'archived' END,
      'inventory','/dashboard/inventory',v_outbox.event_key,NOT v_recipient.in_app_enabled
    )
    ON CONFLICT(recipient_id,event_key) WHERE event_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_notification_id;
    IF v_notification_id IS NOT NULL THEN
      v_count:=v_count+1;
      INSERT INTO public.notification_audit(company_id,notification_id,profile_id,event_type)
      VALUES
        (v_outbox.company_id,v_notification_id,v_recipient.id,'recipient.resolved'),
        (v_outbox.company_id,v_notification_id,v_recipient.id,'notification.created');
      INSERT INTO public.notification_delivery_jobs(notification_id,subscription_id,company_id)
      SELECT v_notification_id,subscription.id,v_outbox.company_id
      FROM public.push_subscriptions AS subscription
      WHERE subscription.profile_id=v_recipient.id AND subscription.company_id=v_outbox.company_id
        AND subscription.revoked_at IS NULL AND v_recipient.push_enabled
        AND NOT (
          coalesce(v_recipient.quiet_hours_enabled,false)
          AND CASE WHEN v_recipient.quiet_hours_start<=v_recipient.quiet_hours_end
            THEN (clock_timestamp() AT TIME ZONE v_recipient.timezone)::time>=v_recipient.quiet_hours_start
             AND (clock_timestamp() AT TIME ZONE v_recipient.timezone)::time<v_recipient.quiet_hours_end
            ELSE (clock_timestamp() AT TIME ZONE v_recipient.timezone)::time>=v_recipient.quiet_hours_start
              OR (clock_timestamp() AT TIME ZONE v_recipient.timezone)::time<v_recipient.quiet_hours_end END
        )
      ON CONFLICT(notification_id,subscription_id) DO NOTHING;
    END IF;
    v_notification_id:=NULL;
  END LOOP;
  UPDATE public.notification_outbox AS outbox SET
    status='completed',lease_token=NULL,lease_expires_at=NULL,completed_at=clock_timestamp()
  WHERE outbox.id=v_outbox.id;
  RETURN QUERY SELECT true,v_count;
END
$function$;

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_storage_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_storage_areas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_low_stock_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_low_stock_thresholds FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_low_stock_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_low_stock_conditions FORCE ROW LEVEL SECURITY;

CREATE POLICY inventory_items_management_select ON public.inventory_items FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.company_id=inventory_items.company_id AND p.status='active' AND p.role IN('manager','owner','super_admin')));
CREATE POLICY inventory_storage_areas_management_select ON public.inventory_storage_areas FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.company_id=inventory_storage_areas.company_id AND p.status='active' AND p.role IN('manager','owner','super_admin')));
CREATE POLICY inventory_balances_management_select ON public.inventory_balances FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.company_id=inventory_balances.company_id AND p.status='active' AND p.role IN('manager','owner','super_admin')));
CREATE POLICY inventory_movements_management_select ON public.inventory_movements FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.company_id=inventory_movements.company_id AND p.status='active' AND p.role IN('manager','owner','super_admin')));
CREATE POLICY inventory_operations_management_select ON public.inventory_operations FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.company_id=inventory_operations.company_id AND p.status='active' AND p.role IN('manager','owner','super_admin')));
CREATE POLICY inventory_thresholds_management_select ON public.inventory_low_stock_thresholds FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.company_id=inventory_low_stock_thresholds.company_id AND p.status='active' AND p.role IN('manager','owner','super_admin')));
CREATE POLICY inventory_conditions_management_select ON public.inventory_low_stock_conditions FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.company_id=inventory_low_stock_conditions.company_id AND p.status='active' AND p.role IN('manager','owner','super_admin')));
CREATE POLICY inventory_count_sessions_scoped_select ON public.inventory_count_sessions FOR SELECT TO authenticated
USING (EXISTS(
  SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.company_id=inventory_count_sessions.company_id AND p.status='active'
    AND (p.role IN('manager','owner','super_admin') OR (p.role='employee' AND p.employee_id=inventory_count_sessions.assigned_employee_id))
));
CREATE POLICY inventory_count_lines_scoped_select ON public.inventory_count_lines FOR SELECT TO authenticated
USING (EXISTS(
  SELECT 1 FROM public.inventory_count_sessions s
  JOIN public.profiles p ON p.id=auth.uid() AND p.company_id=s.company_id AND p.status='active'
  WHERE s.id=inventory_count_lines.session_id AND s.company_id=inventory_count_lines.company_id
    AND (p.role IN('manager','owner','super_admin') OR (p.role='employee' AND p.employee_id=s.assigned_employee_id))
));

ALTER TABLE public.inventory_items OWNER TO postgres;
ALTER TABLE public.inventory_storage_areas OWNER TO postgres;
ALTER TABLE public.inventory_operations OWNER TO postgres;
ALTER TABLE public.inventory_balances OWNER TO postgres;
ALTER TABLE public.inventory_movements OWNER TO postgres;
ALTER TABLE public.inventory_count_sessions OWNER TO postgres;
ALTER TABLE public.inventory_count_lines OWNER TO postgres;
ALTER TABLE public.inventory_low_stock_thresholds OWNER TO postgres;
ALTER TABLE public.inventory_low_stock_conditions OWNER TO postgres;

REVOKE ALL ON TABLE public.inventory_items,public.inventory_storage_areas,public.inventory_operations,
  public.inventory_balances,public.inventory_movements,public.inventory_count_sessions,
  public.inventory_count_lines,public.inventory_low_stock_thresholds,
  public.inventory_low_stock_conditions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.inventory_items,public.inventory_storage_areas,public.inventory_operations,
  public.inventory_balances,public.inventory_movements,public.inventory_count_sessions,
  public.inventory_count_lines,public.inventory_low_stock_thresholds,
  public.inventory_low_stock_conditions TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.inventory_items,public.inventory_storage_areas,
  public.inventory_operations,public.inventory_balances,public.inventory_movements,
  public.inventory_count_sessions,public.inventory_count_lines,public.inventory_low_stock_thresholds,
  public.inventory_low_stock_conditions TO service_role;

ALTER FUNCTION private.validate_inventory_scope() OWNER TO postgres;
ALTER FUNCTION private.reject_inventory_history_mutation() OWNER TO postgres;
ALTER FUNCTION private.validate_inventory_item_update() OWNER TO postgres;
ALTER FUNCTION private.validate_inventory_count_session_update() OWNER TO postgres;
ALTER FUNCTION private.validate_inventory_count_line_update() OWNER TO postgres;
ALTER FUNCTION private.assert_inventory_management(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION private.evaluate_inventory_low_stock(uuid,uuid,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.create_inventory_item(uuid,uuid,text,text,text,text,text,text,numeric) OWNER TO postgres;
ALTER FUNCTION public.update_inventory_item(uuid,uuid,uuid,text,text,text,text,text,text,text,numeric) OWNER TO postgres;
ALTER FUNCTION public.create_inventory_storage_area(uuid,uuid,uuid,text,text) OWNER TO postgres;
ALTER FUNCTION public.set_inventory_storage_area_status(uuid,uuid,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.record_inventory_movement(uuid,uuid,uuid,uuid,uuid,text,numeric,text,uuid,text,uuid,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.transfer_inventory_stock(uuid,uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.create_inventory_count_session(uuid,uuid,uuid,uuid,uuid,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.update_inventory_count(uuid,uuid,uuid,text,jsonb) OWNER TO postgres;
ALTER FUNCTION public.approve_inventory_count(uuid,uuid,uuid,uuid,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.set_inventory_low_stock_threshold(uuid,uuid,uuid,uuid,uuid,numeric) OWNER TO postgres;
ALTER FUNCTION public.list_inventory_stock(uuid,uuid,text,text,boolean,integer) OWNER TO postgres;
ALTER FUNCTION public.materialize_inventory_low_stock_outbox(uuid,uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.validate_inventory_scope() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.reject_inventory_history_mutation() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.validate_inventory_item_update() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.validate_inventory_count_session_update() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.validate_inventory_count_line_update() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.assert_inventory_management(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.evaluate_inventory_low_stock(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_inventory_item(uuid,uuid,text,text,text,text,text,text,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_inventory_item(uuid,uuid,uuid,text,text,text,text,text,text,text,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_inventory_storage_area(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_inventory_storage_area_status(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_inventory_movement(uuid,uuid,uuid,uuid,uuid,text,numeric,text,uuid,text,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.transfer_inventory_stock(uuid,uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_inventory_count_session(uuid,uuid,uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_inventory_count(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.approve_inventory_count(uuid,uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_inventory_low_stock_threshold(uuid,uuid,uuid,uuid,uuid,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_inventory_stock(uuid,uuid,text,text,boolean,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.materialize_inventory_low_stock_outbox(uuid,uuid) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.create_inventory_item(uuid,uuid,text,text,text,text,text,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_inventory_item(uuid,uuid,uuid,text,text,text,text,text,text,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_inventory_storage_area(uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_inventory_storage_area_status(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_inventory_movement(uuid,uuid,uuid,uuid,uuid,text,numeric,text,uuid,text,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_inventory_stock(uuid,uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_inventory_count_session(uuid,uuid,uuid,uuid,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_inventory_count(uuid,uuid,uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_inventory_count(uuid,uuid,uuid,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_inventory_low_stock_threshold(uuid,uuid,uuid,uuid,uuid,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_inventory_stock(uuid,uuid,text,text,boolean,integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.materialize_inventory_low_stock_outbox(uuid,uuid) TO service_role;

COMMENT ON TABLE public.inventory_movements IS 'Authoritative append-only Inventory Stock V1 ledger.';
COMMENT ON TABLE public.inventory_balances IS 'Transactionally maintained non-negative projection; reconcile against inventory_movements.';
COMMENT ON COLUMN public.inventory_count_lines.damaged_quantity IS 'Reported separately; does not alter available stock during approval.';
COMMENT ON FUNCTION public.record_inventory_movement(uuid,uuid,uuid,uuid,uuid,text,numeric,text,uuid,text,uuid,text,uuid)
  IS 'Service-only idempotent atomic movement and balance transition.';
COMMENT ON FUNCTION public.transfer_inventory_stock(uuid,uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,text,uuid)
  IS 'Service-only atomic paired transfer with deterministic balance locking.';
COMMENT ON FUNCTION public.approve_inventory_count(uuid,uuid,uuid,uuid,text,uuid)
  IS 'Service-only stale-safe count approval and idempotent reconciliation.';

-- Read-only post-apply verification queries (do not execute as part of migration):
-- SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname LIKE 'inventory_%' ORDER BY relname;
-- SELECT tablename, policyname, roles, cmd FROM pg_policies WHERE tablename LIKE 'inventory_%' ORDER BY tablename,policyname;
-- SELECT p.oid::regprocedure, r.rolname AS owner, p.prosecdef, p.proconfig,
--        array_to_string(p.proacl, ',') AS grants
-- FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
-- WHERE p.proname LIKE '%inventory%' ORDER BY p.oid::regprocedure::text;
-- SELECT indexname,indexdef FROM pg_indexes WHERE tablename LIKE 'inventory_%' ORDER BY tablename,indexname;
-- SELECT count(*) FROM public.inventory_items;
-- SELECT count(*) FROM public.inventory_movements;
-- SELECT count(*) FROM public.inventory_count_sessions;
-- SELECT count(*) FROM public.inventory_low_stock_conditions;
-- SELECT balance.company_id,balance.location_id,balance.storage_area_id,balance.inventory_item_id,
--        balance.quantity,coalesce(sum(movement.quantity_delta),0) AS ledger_quantity
-- FROM public.inventory_balances balance LEFT JOIN public.inventory_movements movement
--   ON movement.company_id=balance.company_id AND movement.location_id=balance.location_id
--  AND movement.storage_area_id=balance.storage_area_id AND movement.inventory_item_id=balance.inventory_item_id
-- GROUP BY balance.company_id,balance.location_id,balance.storage_area_id,balance.inventory_item_id,balance.quantity
-- HAVING balance.quantity IS DISTINCT FROM coalesce(sum(movement.quantity_delta),0);

COMMIT;
