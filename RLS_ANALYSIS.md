/**
 * RLS 42501 ERROR ANALYSIS
 * 
 * Problem: INSERT into tasks table fails with 42501 (permission denied)
 * Error: "new row violates row-level security policy for table 'tasks'"
 * 
 * ============================================================================
 * DIAGNOSIS
 * ============================================================================
 * 
 * RLS Policy Chain:
 * 1. Server-side code validates auth context and extracts company_id from profiles
 * 2. Code sets company_id in INSERT object
 * 3. INSERT is sent to Supabase with this company_id
 * 4. Supabase RLS policy evaluates WITH CHECK clause:
 *    
 *    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
 * 
 * 5. If this returns false → 42501 error (RLS violation)
 * 
 * ============================================================================
 * ROOT CAUSE (Most Likely)
 * ============================================================================
 * 
 * The WITH CHECK subquery checks:
 *   - Does profiles table have a row where id = auth.uid()?
 *   - Does that row's company_id match the company_id being inserted?
 * 
 * Failure scenarios:
 * A) profiles table has no row for auth.uid() → subquery returns empty → company_id NOT IN empty set → FAIL
 * B) profiles row exists but company_id IS NULL → company_id NOT IN (NULL) → FAIL
 * C) profiles row has different company_id → company_id NOT IN (different_id) → FAIL
 * 
 * ============================================================================
 * WORKING PATTERN (From inventory_items & customers)
 * ============================================================================
 * 
 * Tables with working RLS:
 * - inventory_items
 * - inventory_movements
 * - customers
 * - customer_interactions
 * 
 * All use identical pattern:
 * 
 *   CREATE POLICY "Users can create [table] for their company"
 *     ON [table] FOR INSERT
 *     WITH CHECK (
 *       company_id IN (
 *         SELECT company_id FROM profiles WHERE id = auth.uid()
 *       )
 *     );
 * 
 * These WORK, which means:
 * - auth.uid() is correctly resolving to authenticated user
 * - profiles table has rows with company_id values for these users
 * - RLS evaluation is working properly
 * 
 * ============================================================================
 * WHY TASKS MIGHT FAIL
 * ============================================================================
 * 
 * 1. Tasks table RLS policies not yet created in live Supabase database
 *    (migration file created but not executed)
 * 
 * 2. Tasks table policies exist but are disabled
 * 
 * 3. Tasks table policies exist but have different logic than working tables
 * 
 * ============================================================================
 * SOLUTION
 * ============================================================================
 * 
 * 1. Drop all existing RLS policies on tasks (clean slate)
 * 2. Create fresh policies using EXACT same pattern as working tables
 * 3. Enable RLS on tasks table
 * 4. Add server-side logging to capture:
 *    - auth.uid() value being sent
 *    - profiles row found or not
 *    - company_id in profile
 *    - company_id being inserted
 *    - comparison result
 * 5. Test with real authenticated user
 * 
 * ============================================================================
 * NOTES
 * ============================================================================
 * 
 * - Do NOT use service role key (requirement)
 * - Policies must enforce company isolation via auth context
 * - WITH CHECK for INSERT is applied to new row being inserted
 * - USING for SELECT/UPDATE/DELETE is applied to existing rows
 * - Both must check company_id membership
 */
