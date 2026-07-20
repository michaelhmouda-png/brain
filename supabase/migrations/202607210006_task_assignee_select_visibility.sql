-- Narrow task SELECT visibility without changing task mutation policies.

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select
  ON public.tasks
  FOR SELECT
  TO authenticated
  USING (
    private.is_active_user()
    AND public.tasks.company_id = private.current_user_company_id()
    AND (
      private.current_user_role() IN ('super_admin', 'owner', 'manager')
      OR EXISTS (
        SELECT 1
          FROM public.profiles AS pr
          JOIN public.employees AS emp
            ON emp.id = pr.employee_id
           AND emp.company_id = pr.company_id
         WHERE pr.id = auth.uid()
           AND pr.status = 'active'
           AND pr.company_id = public.tasks.company_id
           AND pr.employee_id = public.tasks.assigned_employee_id
      )
    )
  );

COMMENT ON POLICY tasks_select ON public.tasks IS
  'Active managers read persisted-company tasks; active same-company linked users read only tasks assigned to their employee UUID.';

-- Safe self-diagnostic used only to distinguish an empty assignment set from
-- SELECT-policy drift. It returns no task content or other employee identity.
CREATE OR REPLACE FUNCTION public.get_my_task_visibility_diagnostic()
RETURNS TABLE (
  persisted_role text,
  employee_linked boolean,
  assigned_task_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT
    pr.role,
    (pr.employee_id IS NOT NULL AND emp.id IS NOT NULL),
    CASE
      WHEN pr.employee_id IS NULL OR emp.id IS NULL THEN 0::bigint
      ELSE (
        SELECT count(*)
          FROM public.tasks AS t
         WHERE t.company_id = pr.company_id
           AND t.assigned_employee_id = pr.employee_id
      )
    END
  FROM public.profiles AS pr
  LEFT JOIN public.employees AS emp
    ON emp.id = pr.employee_id
   AND emp.company_id = pr.company_id
  WHERE pr.id = auth.uid()
    AND pr.status = 'active';
$$;

REVOKE ALL ON FUNCTION public.get_my_task_visibility_diagnostic() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_task_visibility_diagnostic() TO authenticated;
