# 📋 Apply Tasks RLS Policies - Step by Step

## Overview
The tasks table RLS policies use the EXACT same helper functions and pattern as the working tables (employees, departments, locations).

**Helper functions used (all already exist in private schema):**
- `private.is_active_user()` - Checks if user status = 'active'
- `private.is_super_admin()` - Checks if user role = 'super_admin'  
- `private.current_user_company_id()` - Returns user's company_id
- `private.can_manage_company(company_id)` - Checks if user can manage that company

---

## Method 1: Manual SQL Execution (Recommended - Simple)

### Step 1: Open Supabase SQL Editor
Go to: https://supabase.com/dashboard/project/jjhtasppfxunbrswgxht/sql/new

### Step 2: Copy the SQL from tasks_rls_fix.sql
File: `c:\Users\USER\brain\tasks_rls_fix.sql`

The SQL includes:
1. Enable RLS on tasks table
2. Drop all existing policies (idempotent)
3. Create 4 new policies:
   - `tasks_select` - Users read own company tasks; super_admin reads all
   - `tasks_insert` - Only owner/manager/super_admin can create tasks
   - `tasks_update` - Only owner/manager/super_admin can update tasks
   - `tasks_delete` - Only owner/manager/super_admin can delete tasks

### Step 3: Paste into SQL Editor
- Click in the SQL editor
- Paste the SQL content
- Click the **Run** button (or Ctrl+Enter)

### Step 4: Verify Success
Expected output: "4 rows" indicating 4 policies created successfully

```
✓ Policies created:
  1. tasks_select
  2. tasks_insert
  3. tasks_update
  4. tasks_delete
```

---

## SQL Policy Pattern (Identical to Employees Table)

```sql
-- SELECT: Active users can read own company data; super_admin reads all
CREATE POLICY "tasks_select" ON public.tasks
  FOR SELECT
  USING (
    private.is_active_user()
    AND (
      private.is_super_admin()
      OR company_id = private.current_user_company_id()
    )
  );

-- INSERT: Only those who can manage the company can create tasks
CREATE POLICY "tasks_insert" ON public.tasks
  FOR INSERT
  WITH CHECK (
    private.can_manage_company(company_id)
  );

-- UPDATE: Only those who can manage the company can update tasks
CREATE POLICY "tasks_update" ON public.tasks
  FOR UPDATE
  USING (
    private.can_manage_company(company_id)
  )
  WITH CHECK (
    private.can_manage_company(company_id)
  );

-- DELETE: Only those who can manage the company can delete tasks
CREATE POLICY "tasks_delete" ON public.tasks
  FOR DELETE
  USING (
    private.can_manage_company(company_id)
  );
```

---

## Role Permissions After RLS Applied

**super_admin (must be active):**
- ✓ Can read/write/delete ALL tasks across ALL companies

**owner (must be active, must belong to company):**
- ✓ Can read tasks in own company
- ✓ Can create/update/delete tasks in own company
- ✗ Cannot access tasks from other companies

**manager (must be active, must belong to company):**
- ✓ Can read tasks in own company
- ✓ Can create/update/delete tasks in own company
- ✗ Cannot access tasks from other companies

**employee (must be active, must belong to company):**
- ✓ Can read tasks in own company (SELECT only via private.can_manage_company → READ only)
- ✗ Cannot create/update/delete tasks

---

## Verification After Applying Policies

Check policies were created:

```sql
-- View all policies on tasks table
SELECT policyname, cmd, QUAL, WITH_CHECK
FROM pg_policies
WHERE tablename = 'tasks'
ORDER BY policyname;
```

Expected output: 4 rows with policies named:
- tasks_delete
- tasks_insert  
- tasks_select
- tasks_update

---

## Next Step: Test Task Creation

After policies are applied, test the command:

```
Assign Maroun to restock the bar tomorrow. It is urgent.
```

Expected flow:
1. ✓ AI parses command → priority="urgent" (→ "critical"), employee="Maroun", due_date="tomorrow"
2. ✓ Server resolves names to UUIDs within authenticated company context
3. ✓ Confirmation card shows action for user approval
4. ✓ User confirms
5. ✓ Database INSERT passes RLS check (user company_id matches insert company_id)
6. ✓ Task created successfully

Debug logging will show:
```
[Brain Chat] User ID: <uuid>
[Brain Chat] Company ID to insert: <uuid>
[Brain Chat] ✓ Profile found
[Brain Chat] ✓ Company ID match: true
[Brain Chat] ✓ RLS context verified. Proceeding with insert...
[Brain Chat] ✓ Task created successfully: <task-id>
```

---

## Troubleshooting

**Issue: "42501 - row-level security policy violation"**
- Cause: RLS policies don't exist or user profile company_id doesn't match
- Solution: Ensure all 4 policies are created (verify via pg_policies query above)
- Check: User profile has company_id and status='active'

**Issue: "No policies exist for tasks table"**
- Cause: SQL execution failed silently
- Solution: Verify by querying pg_policies (see Verification section)
- Re-run the SQL to create policies

**Issue: "private.can_manage_company() function not found"**
- Cause: Helper functions not created in auth_schema.sql
- Solution: Ensure auth_schema.sql was executed first to create private schema and helper functions

---

## Files Created

1. **tasks_rls_fix.sql** - The SQL migration with all 4 RLS policies
   - Location: `c:\Users\USER\brain\tasks_rls_fix.sql`
   - Use this for manual execution in Supabase dashboard

2. **apply-tasks-rls/route.ts** - API endpoint (optional, for automated execution)
   - Location: `c:\Users\USER\brain\app\api\admin\apply-tasks-rls\route.ts`
   - POST /api/admin/apply-tasks-rls (requires admin auth)

3. **This document** - Instructions and reference
   - Location: This file

---

## Summary

✅ **What's Done:**
- Created RLS policies using exact pattern from employees table
- Policies use proven helper functions: is_active_user(), is_super_admin(), can_manage_company()
- No new helper functions invented - uses existing infrastructure
- SQL migration ready for execution

⏳ **What's Next:**
1. Execute tasks_rls_fix.sql in Supabase SQL editor
2. Verify 4 policies created successfully
3. Test command: "Assign Maroun to restock the bar tomorrow. It is urgent."
4. Verify task created with correct values:
   - priority: "critical" (lowercase)
   - status: "pending" (lowercase)
   - assigned_employee_id: Maroun's UUID
   - due_date: tomorrow
   - company_id: user's company (from auth context)

---

**Created:** 2026-07-17
**Updated by:** GitHub Copilot
**Status:** Ready for execution
