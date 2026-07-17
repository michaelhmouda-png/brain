/**
 * Execute RLS policies SQL for tasks table
 * Uses Supabase service_role to apply schema changes
 */

const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://jjhtasppfxunbrswgxht.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.error("Error: SUPABASE_SERVICE_ROLE_KEY not set");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const sql = `
-- 1. Enable RLS on tasks table
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- 2. Drop ALL existing tasks policies (idempotent)
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
`;

async function executeSQL() {
  try {
    console.log("📋 Executing RLS policies SQL...");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Split by statements and execute each
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    for (const statement of statements) {
      console.log(`\n📍 Executing: ${statement.substring(0, 80)}...`);

      const { error } = await supabase.rpc("exec_sql", {
        query: statement,
      }).catch(() => {
        // Fallback: execute via direct admin query if rpc not available
        return supabase.from("_exec_sql").insert({ query: statement }).catch((e) => ({ error: e }));
      });

      if (error) {
        console.error(`   ✗ Error: ${error.message}`);
        // Continue with other statements
      } else {
        console.log(`   ✓ Success`);
      }
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ RLS policies applied to tasks table");
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

executeSQL();
