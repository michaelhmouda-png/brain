/**
 * /api/admin/apply-tasks-rls
 * 
 * Admin endpoint to apply RLS policies to tasks table
 * Requires: authenticated user with super_admin or owner role
 * 
 * Usage: POST /api/admin/apply-tasks-rls
 * 
 * This endpoint:
 * 1. Verifies user is authenticated
 * 2. Checks user role is super_admin or owner
 * 3. Executes SQL to create RLS policies on tasks table
 * 4. Returns status/result
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  try {
    // 1. Get auth session from request
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid Authorization header" },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);

    // 2. Initialize Supabase client with user's token
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing Supabase environment variables");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    // Use service role to execute SQL
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    // 3. Get user details via service role
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.admin.getUserById(token);

    if (userError || !user) {
      return NextResponse.json(
        { error: "Could not verify user identity" },
        { status: 401 }
      );
    }

    // 4. Check user role
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "Could not retrieve user profile" },
        { status: 403 }
      );
    }

    const userRole = profile.role;
    if (userRole !== "super_admin" && userRole !== "owner") {
      return NextResponse.json(
        {
          error: `Insufficient permissions. Role: ${userRole}. Required: super_admin or owner`,
        },
        { status: 403 }
      );
    }

    console.log(`[Admin API] ${user.email} (${userRole}) applying RLS policies to tasks`);

    // 5. SQL to apply RLS policies
    const rls_sql = `
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

    // 6. Execute SQL via rpc (if available) or raw SQL call
    let result: any;
    let error: any;

    try {
      // Try using the admin API to execute raw SQL
      const response = await fetch(
        `${supabaseUrl}/rest/v1/rpc/exec_sql`,
        {
          method: "POST",
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sql: rls_sql }),
        }
      );

      if (!response.ok) {
        // If rpc endpoint doesn't exist, try using pg_temp
        console.log("exec_sql RPC not available, trying alternative method...");

        // Alternative: use a prepared statement approach
        // This would require a custom RPC, so for now return instructions
        return NextResponse.json(
          {
            error:
              "SQL execution not available through this endpoint. Please execute manually.",
            instructions: `
              1. Go to https://supabase.com/dashboard/project/jjhtasppfxunbrswgxht/sql/new
              2. Copy the SQL from: /files/tasks_rls_fix.sql
              3. Paste into the SQL editor
              4. Click Run
              5. Verify 4 policies are created successfully
            `,
            sql: rls_sql,
          },
          { status: 503 }
        );
      }

      result = await response.json();
    } catch (e: any) {
      console.error("SQL execution error:", e.message);
      // Return the SQL for manual execution
      return NextResponse.json(
        {
          error: "Could not execute SQL through API",
          instructions: `
            1. Go to https://supabase.com/dashboard/project/jjhtasppfxunbrswgxht/sql/new
            2. Copy and paste the provided SQL
            3. Click Run
          `,
          sql: rls_sql,
        },
        { status: 503 }
      );
    }

    console.log("[Admin API] ✓ RLS policies applied successfully");

    return NextResponse.json(
      {
        success: true,
        message: "RLS policies applied to tasks table",
        applied_policies: ["tasks_select", "tasks_insert", "tasks_update", "tasks_delete"],
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[Admin API] Unexpected error:", err);
    return NextResponse.json(
      { error: `Server error: ${err.message}` },
      { status: 500 }
    );
  }
}
