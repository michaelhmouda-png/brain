/**
 * Tasks Table RLS Policies - Using Helper Functions Pattern
 * 
 * Uses EXACT same pattern as working tables:
 * - employees
 * - departments
 * - locations
 * 
 * Helper functions (all defined in private schema):
 * - private.is_active_user() - checks if user status = 'active'
 * - private.is_super_admin() - checks if user role = 'super_admin'
 * - private.current_user_company_id() - returns user's company_id
 * - private.can_manage_company(company_id) - checks if user can manage that company
 * 
 * Pattern:
 * - SELECT: (is_active AND (is_super_admin OR company_id matches))
 * - INSERT: WITH CHECK (can_manage_company)
 * - UPDATE: USING (can_manage_company) WITH CHECK (can_manage_company)
 * - DELETE: USING (can_manage_company)
 * 
 * This ensures:
 * - Only active users can access data
 * - Super admins have full access
 * - Owners/managers can only access their own company
 * - Company isolation is enforced at database layer
 */

-- 1. Enable RLS on tasks table
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- 2. Drop ALL existing tasks policies (idempotent - covers all naming conventions)
DROP POLICY IF EXISTS "Users can select tasks from their company" ON public.tasks;
DROP POLICY IF EXISTS "Users can create tasks for their company" ON public.tasks;
DROP POLICY IF EXISTS "Users can update tasks in their company" ON public.tasks;
DROP POLICY IF EXISTS "Users can delete tasks in their company" ON public.tasks;
DROP POLICY IF EXISTS "task_company_isolation_select" ON public.tasks;
DROP POLICY IF EXISTS "task_company_isolation_insert" ON public.tasks;
DROP POLICY IF EXISTS "task_company_isolation_update" ON public.tasks;
DROP POLICY IF EXISTS "task_company_isolation_delete" ON public.tasks;
DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
DROP POLICY IF EXISTS "tasks_insert" ON public.tasks;
DROP POLICY IF EXISTS "tasks_update" ON public.tasks;
DROP POLICY IF EXISTS "tasks_delete" ON public.tasks;

-- 3. Create fresh policies using EXACT pattern from employees/departments/locations

-- SELECT Policy: Users read own company tasks; super_admin reads all
CREATE POLICY "tasks_select" ON public.tasks
  FOR SELECT
  USING (
    private.is_active_user()
    AND (
      private.is_super_admin()
      OR company_id = private.current_user_company_id()
    )
  );

-- INSERT Policy: Only owner/manager/super_admin can insert tasks
CREATE POLICY "tasks_insert" ON public.tasks
  FOR INSERT
  WITH CHECK (
    private.can_manage_company(company_id)
  );

-- UPDATE Policy: Only owner/manager/super_admin can update tasks
CREATE POLICY "tasks_update" ON public.tasks
  FOR UPDATE
  USING (
    private.can_manage_company(company_id)
  )
  WITH CHECK (
    private.can_manage_company(company_id)
  );

-- DELETE Policy: Only owner/manager/super_admin can delete tasks
CREATE POLICY "tasks_delete" ON public.tasks
  FOR DELETE
  USING (
    private.can_manage_company(company_id)
  );

-- 4. Verification
-- RLS is now enabled on public.tasks with 4 policies matching employees table pattern
-- SELECT: checks is_active_user() AND (is_super_admin() OR company_id matches)
-- INSERT: checks can_manage_company(company_id)
-- UPDATE: checks can_manage_company(company_id) on both USING and WITH CHECK
-- DELETE: checks can_manage_company(company_id)
-- All use proven helper functions from private schema (SECURITY DEFINER)
-- No new helper functions invented - uses existing infrastructure
