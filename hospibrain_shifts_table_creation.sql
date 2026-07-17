DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'shifts') THEN
    CREATE TABLE public.shifts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
      employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
      shift_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      shift_type TEXT DEFAULT 'custom' CHECK (shift_type IN ('morning', 'afternoon', 'evening', 'night', 'custom')),
      department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
      notes TEXT,
      status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
      created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
    );
  END IF;
END $$;

ALTER TABLE IF EXISTS public.shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shifts_select ON public.shifts;
CREATE POLICY shifts_select ON public.shifts FOR SELECT
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS shifts_insert ON public.shifts;
CREATE POLICY shifts_insert ON public.shifts FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS shifts_update ON public.shifts;
CREATE POLICY shifts_update ON public.shifts FOR UPDATE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS shifts_delete ON public.shifts;
CREATE POLICY shifts_delete ON public.shifts FOR DELETE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE INDEX IF NOT EXISTS idx_shifts_company_id ON public.shifts(company_id);
CREATE INDEX IF NOT EXISTS idx_shifts_employee_id ON public.shifts(employee_id);
CREATE INDEX IF NOT EXISTS idx_shifts_shift_date ON public.shifts(shift_date);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON public.shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_created_at ON public.shifts(created_at);
