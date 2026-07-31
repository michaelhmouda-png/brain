-- Employee department compatibility persistence repair.
-- Forward-only, creates no business rows and performs no backfill.

BEGIN;

CREATE OR REPLACE FUNCTION private.enforce_employee_department_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_department public.departments;
  v_location_id uuid;
BEGIN
  IF NEW.department_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_DEPARTMENT_REQUIRED' USING ERRCODE='22023';
  END IF;

  SELECT department.* INTO v_department
  FROM public.departments AS department
  WHERE department.id=NEW.department_id
    AND department.company_id=NEW.company_id
    AND department.status='active'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EMPLOYEE_DEPARTMENT_INVALID' USING ERRCODE='22023';
  END IF;

  IF NEW.location_id IS NOT NULL THEN
    SELECT location.id INTO v_location_id
    FROM public.locations AS location
    WHERE location.id=NEW.location_id
      AND location.company_id=NEW.company_id
      AND location.status='active'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'EMPLOYEE_LOCATION_INVALID' USING ERRCODE='22023';
    END IF;
  END IF;

  -- Browser-supplied compatibility text is never trusted.
  NEW.department_id:=v_department.id;
  NEW.department:=v_department.name;

  IF TG_OP='UPDATE' THEN
    IF OLD.lifecycle_status='archived' THEN
      RAISE EXCEPTION 'EMPLOYEE_ARCHIVED' USING ERRCODE='22023';
    END IF;
    NEW.version:=OLD.version+1;
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION private.enforce_employee_department_consistency() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_employee_department_consistency()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER employees_department_consistency
BEFORE INSERT OR UPDATE OF
  company_id,
  location_id,
  department_id,
  first_name,
  last_name,
  role,
  phone,
  email,
  employment_type,
  salary,
  hire_date,
  status,
  notes
ON public.employees
FOR EACH ROW EXECUTE FUNCTION private.enforce_employee_department_consistency();

COMMENT ON FUNCTION private.enforce_employee_department_consistency() IS
  'Atomically resolves active same-company employee departments and maintains the legacy department name.';

COMMIT;
