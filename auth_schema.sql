/**
 * Auth Schema for Brain - HARDENED VERSION
 * 
 * SECURITY ARCHITECTURE:
 * - SECURITY DEFINER helper functions with hardened search_path and qualified names
 * - All policies check status = 'active' to enforce account activation
 * - super_admin has full access through policies (cannot directly manage via RLS)
 * - owner/manager can manage their company's data via policies
 * - employee has read-only access via policies
 * - Users can only update their own full_name via dedicated RPC
 * - Private schema protected from Data API
 * - Idempotent: safe to rerun
 * - Transactional: wrapped in BEGIN...COMMIT
 * 
 * APPLY THIS MANUALLY after reviewing
 */

BEGIN;

-- 1. Create private schema for secure helper functions
-- Do not expose this through Data API
create schema if not exists private;

-- Prevent schema access via Data API
revoke create on schema private from anon;
revoke create on schema private from public;
revoke create on schema private from "authenticated";

-- Allow authenticated users to USE (not CREATE) private schema functions
grant usage on schema private to authenticated;

-- 2. Create profiles table FIRST (before helper functions reference it)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  full_name text,
  role text not null default 'employee' check (role in ('super_admin', 'owner', 'manager', 'employee')),
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'User profiles linked to Supabase Auth users. Managed by service role only (no authenticated client INSERT/UPDATE/DELETE).';
comment on column public.profiles.id is 'Foreign key to auth.users(id), automatically deleted when user is deleted';
comment on column public.profiles.company_id is 'The company this user belongs to; null for super_admin users';
comment on column public.profiles.employee_id is 'Optional link to an employee record';
comment on column public.profiles.role is 'User role: super_admin (all companies), owner (own company), manager (own company), employee (read-only)';
comment on column public.profiles.status is 'User status: active, inactive, or suspended. Only active users can access data.';

-- 3. Enable RLS on profiles
alter table public.profiles enable row level security;

-- 4. Create hardened SECURITY DEFINER helper functions in private schema
-- These functions execute as the owner (bypassing RLS) to avoid recursion
-- All use set search_path = '' for maximum security

create or replace function private.current_user_role()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Restrict execute permission: authenticated only (no public, no anon)
grant execute on function private.current_user_role() to authenticated;
revoke execute on function private.current_user_role() from public, anon;

-- ---

create or replace function private.current_user_company_id()
returns uuid
language sql
security definer
set search_path = ''
stable
as $$
  select company_id from public.profiles where id = auth.uid();
$$;

grant execute on function private.current_user_company_id() to authenticated;
revoke execute on function private.current_user_company_id() from public, anon;

-- ---

create or replace function private.is_active_user()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select status = 'active' from public.profiles where id = auth.uid();
$$;

grant execute on function private.is_active_user() to authenticated;
revoke execute on function private.is_active_user() from public, anon;

-- ---

create or replace function private.is_super_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(private.current_user_role() = 'super_admin', false);
$$;

grant execute on function private.is_super_admin() to authenticated;
revoke execute on function private.is_super_admin() from public, anon;

-- ---

create or replace function private.can_manage_company(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select 
    (private.is_super_admin() and private.is_active_user())
    or (private.current_user_role() in ('owner', 'manager') 
        and private.current_user_company_id() = target_company_id
        and private.is_active_user());
$$;

grant execute on function private.can_manage_company(uuid) to authenticated;
revoke execute on function private.can_manage_company(uuid) from public, anon;

-- ---

-- 5. Create dedicated RPC for updating own full_name (preferred approach vs policy)
-- This function enforces: only current user, only updates full_name, user must be active
create or replace function public.update_own_full_name(new_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_id uuid;
begin
  user_id := auth.uid();
  if user_id is null then
    raise exception 'Not authenticated';
  end if;
  
  -- Verify user is active before allowing update
  if not exists(select 1 from public.profiles where id = user_id and status = 'active') then
    raise exception 'User account is not active';
  end if;
  
  -- Update ONLY full_name for the current user
  update public.profiles 
  set full_name = new_full_name, updated_at = now()
  where id = user_id;
end;
$$;

grant execute on function public.update_own_full_name(text) to authenticated;
revoke execute on function public.update_own_full_name(text) from public, anon;


-- 6. RLS Policies for profiles table
-- All profiles policies explicitly defined below

-- Drop ALL existing profiles policies (legacy + new names, for idempotency)
drop policy if exists "users_can_read_own_profile" on public.profiles;
drop policy if exists "users_can_read_company_profiles" on public.profiles;
drop policy if exists "super_admin_can_read_all_profiles" on public.profiles;
drop policy if exists "users_can_update_own_profile" on public.profiles;
drop policy if exists "no_direct_profile_insert" on public.profiles;
drop policy if exists "no_direct_profile_delete" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_company" on public.profiles;
drop policy if exists "profiles_insert_deny" on public.profiles;
drop policy if exists "profiles_update_deny" on public.profiles;
drop policy if exists "profiles_delete_deny" on public.profiles;

-- SELECT Policy: Users can read their own profile if active
create policy "profiles_select_own" on public.profiles
  for select using (
    auth.uid() = id 
    and private.is_active_user()
  );

-- SELECT Policy: Users can read other profiles in their company if active
-- Does NOT query profiles table; uses helper function instead
create policy "profiles_select_company" on public.profiles
  for select using (
    private.is_active_user()
    and (
      private.is_super_admin()
      or (
        private.current_user_company_id() is not null
        and private.current_user_company_id() = company_id
      )
    )
  );

-- INSERT Policy: Prevent authenticated clients from inserting profiles
-- Profiles are created via service role only
create policy "profiles_insert_deny" on public.profiles
  for insert with check (false);

-- UPDATE Policy: Prevent authenticated clients from updating profiles
-- Use public.update_own_full_name() RPC instead
create policy "profiles_update_deny" on public.profiles
  for update using (false)
  with check (false);

-- DELETE Policy: Prevent authenticated clients from deleting profiles
-- Deletion cascades automatically when auth.users are deleted
create policy "profiles_delete_deny" on public.profiles
  for delete using (false);


-- 7. Enable RLS on companies
alter table public.companies enable row level security;

-- Drop ALL existing companies policies (legacy + new names, for idempotency)
drop policy if exists "users_can_read_own_company" on public.companies;
drop policy if exists "super_admin_can_read_all_companies" on public.companies;
drop policy if exists "owner_manager_can_update_company" on public.companies;
drop policy if exists "owner_manager_can_insert_company" on public.companies;
drop policy if exists "super_admin_can_insert_company" on public.companies;
drop policy if exists "super_admin_can_update_company" on public.companies;
drop policy if exists "super_admin_can_delete_company" on public.companies;
drop policy if exists "companies_select" on public.companies;
drop policy if exists "companies_insert" on public.companies;
drop policy if exists "companies_update" on public.companies;
drop policy if exists "companies_delete" on public.companies;

-- SELECT Policy: Users can read their company; super_admin reads all
create policy "companies_select" on public.companies
  for select using (
    private.is_active_user()
    and (
      private.is_super_admin()
      or id = private.current_user_company_id()
    )
  );

-- INSERT Policy: Only super_admin can create companies (via policy + helper function)
create policy "companies_insert" on public.companies
  for insert with check (
    private.is_super_admin() 
    and private.is_active_user()
  );

-- UPDATE Policy: Only super_admin can update companies
create policy "companies_update" on public.companies
  for update using (
    private.is_super_admin()
    and private.is_active_user()
  )
  with check (
    private.is_super_admin()
    and private.is_active_user()
  );

-- DELETE Policy: Only super_admin can delete companies
create policy "companies_delete" on public.companies
  for delete using (
    private.is_super_admin()
    and private.is_active_user()
  );

-- 8. Enable RLS on locations
alter table public.locations enable row level security;

-- Drop ALL existing locations policies (legacy + new names, for idempotency)
drop policy if exists "users_can_read_own_company_locations" on public.locations;
drop policy if exists "super_admin_can_read_all_locations" on public.locations;
drop policy if exists "owner_manager_can_insert_location" on public.locations;
drop policy if exists "owner_manager_can_update_location" on public.locations;
drop policy if exists "owner_manager_can_delete_location" on public.locations;
drop policy if exists "locations_select" on public.locations;
drop policy if exists "locations_insert" on public.locations;
drop policy if exists "locations_update" on public.locations;
drop policy if exists "locations_delete" on public.locations;

-- SELECT Policy: Users read own company locations; super_admin reads all
create policy "locations_select" on public.locations
  for select using (
    private.is_active_user()
    and (
      private.is_super_admin()
      or company_id = private.current_user_company_id()
    )
  );

-- INSERT Policy: Only owner/manager/super_admin can insert locations
create policy "locations_insert" on public.locations
  for insert with check (
    private.can_manage_company(company_id)
  );

-- UPDATE Policy: Only owner/manager/super_admin can update locations
create policy "locations_update" on public.locations
  for update using (
    private.can_manage_company(company_id)
  )
  with check (
    private.can_manage_company(company_id)
  );

-- DELETE Policy: Only owner/manager/super_admin can delete locations
create policy "locations_delete" on public.locations
  for delete using (
    private.can_manage_company(company_id)
  );

-- 9. Enable RLS on departments
alter table public.departments enable row level security;

-- Drop ALL existing departments policies (legacy + new names, for idempotency)
drop policy if exists "users_can_read_own_company_departments" on public.departments;
drop policy if exists "super_admin_can_read_all_departments" on public.departments;
drop policy if exists "owner_manager_can_insert_department" on public.departments;
drop policy if exists "owner_manager_can_update_department" on public.departments;
drop policy if exists "owner_manager_can_delete_department" on public.departments;
drop policy if exists "departments_select" on public.departments;
drop policy if exists "departments_insert" on public.departments;
drop policy if exists "departments_update" on public.departments;
drop policy if exists "departments_delete" on public.departments;

-- SELECT Policy: Users read own company departments; super_admin reads all
create policy "departments_select" on public.departments
  for select using (
    private.is_active_user()
    and (
      private.is_super_admin()
      or company_id = private.current_user_company_id()
    )
  );

-- INSERT Policy: Only owner/manager/super_admin can insert departments
create policy "departments_insert" on public.departments
  for insert with check (
    private.can_manage_company(company_id)
  );

-- UPDATE Policy: Only owner/manager/super_admin can update departments
create policy "departments_update" on public.departments
  for update using (
    private.can_manage_company(company_id)
  )
  with check (
    private.can_manage_company(company_id)
  );

-- DELETE Policy: Only owner/manager/super_admin can delete departments
create policy "departments_delete" on public.departments
  for delete using (
    private.can_manage_company(company_id)
  );

-- 10. Enable RLS on employees
alter table public.employees enable row level security;

-- Drop ALL existing employees policies (legacy + new names, for idempotency)
drop policy if exists "users_can_read_own_company_employees" on public.employees;
drop policy if exists "super_admin_can_read_all_employees" on public.employees;
drop policy if exists "owner_manager_can_insert_employee" on public.employees;
drop policy if exists "owner_manager_can_update_employee" on public.employees;
drop policy if exists "owner_manager_can_delete_employee" on public.employees;
drop policy if exists "employees_select" on public.employees;
drop policy if exists "employees_insert" on public.employees;
drop policy if exists "employees_update" on public.employees;
drop policy if exists "employees_delete" on public.employees;

-- SELECT Policy: Users read own company employees; super_admin reads all
create policy "employees_select" on public.employees
  for select using (
    private.is_active_user()
    and (
      private.is_super_admin()
      or company_id = private.current_user_company_id()
    )
  );

-- INSERT Policy: Only owner/manager/super_admin can insert employees
create policy "employees_insert" on public.employees
  for insert with check (
    private.can_manage_company(company_id)
  );

-- UPDATE Policy: Only owner/manager/super_admin can update employees
create policy "employees_update" on public.employees
  for update using (
    private.can_manage_company(company_id)
  )
  with check (
    private.can_manage_company(company_id)
  );

-- DELETE Policy: Only owner/manager/super_admin can delete employees
create policy "employees_delete" on public.employees
  for delete using (
    private.can_manage_company(company_id)
  );

-- 11. Create indexes for query performance
create index if not exists idx_profiles_company_id on public.profiles(company_id);
create index if not exists idx_profiles_employee_id on public.profiles(employee_id);
create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_status on public.profiles(status);

/**
 * SECURITY MODEL DOCUMENTATION (HARDENED VERSION)
 * 
 * HELPER FUNCTIONS (in private schema, SECURITY DEFINER, hardened):
 * ================================================================
 * - All use set search_path = '' for maximum security
 * - All use fully qualified names (auth.uid(), public.profiles)
 * - All have restricted execute grants (authenticated only, revoked from public/anon)
 * - private.current_user_role() - returns user's role or NULL
 * - private.current_user_company_id() - returns user's company_id or NULL
 * - private.is_active_user() - returns true if status = 'active'
 * - private.is_super_admin() - returns true if role = 'super_admin'
 * - private.can_manage_company(company_id) - returns true if user can edit company data
 * 
 * PUBLIC RPC FUNCTIONS (authenticated users):
 * ==========================================
 * - public.update_own_full_name(text) - ONLY way to update own profile
 *   * Only authenticated users with status='active' can execute
 *   * Updates ONLY the full_name column for current user
 *   * Updates updated_at timestamp
 *   * Cannot modify role, status, company_id, employee_id
 * 
 * ROLE PERMISSIONS (via RLS policies):
 * ====================================
 * 
 * super_admin (must be active):
 *   - Can read/write/delete ALL data across ALL companies
 *   - Can create/update/delete companies (via policies)
 *   - Can create/update/delete locations, departments, employees anywhere
 *   - CAN view all profiles via profiles_select_company policy
 *   - CANNOT directly INSERT/UPDATE/DELETE profiles (use service role only)
 * 
 * owner (must be active, must belong to company):
 *   - Can read own company data only
 *   - Can create/update/delete locations, departments, employees IN OWN COMPANY
 *   - Can view profiles IN OWN COMPANY (via profiles_select_company)
 *   - CANNOT create/update/delete companies
 *   - CANNOT directly INSERT/UPDATE/DELETE profiles (use service role only)
 *   - CAN update own full_name via public.update_own_full_name()
 * 
 * manager (must be active, must belong to company):
 *   - Can read own company data only
 *   - Can create/update/delete locations, departments, employees IN OWN COMPANY
 *   - Can view profiles IN OWN COMPANY (via profiles_select_company)
 *   - CANNOT create/update/delete companies
 *   - CANNOT directly INSERT/UPDATE/DELETE profiles (use service role only)
 *   - CAN update own full_name via public.update_own_full_name()
 * 
 * employee (must be active, must belong to company):
 *   - Can read own company data only (SELECT on locations, departments, employees, profiles)
 *   - READ-ONLY: Cannot create/update/delete any data
 *   - Can view profiles IN OWN COMPANY (via profiles_select_company)
 *   - CANNOT directly INSERT/UPDATE/DELETE profiles (use service role only)
 *   - CAN update own full_name via public.update_own_full_name()
 * 
 * PROFILE MANAGEMENT (SERVICE ROLE ONLY):
 * =======================================
 * - Profiles CAN ONLY BE CREATED by service role (INSERT policy = false)
 * - Profiles CAN ONLY BE UPDATED by service role (UPDATE policy = false)
 * - Profiles CAN ONLY BE DELETED by cascade when auth.users deleted (DELETE policy = false)
 * - Authenticated clients cannot directly manipulate profiles
 * - Full_name updates ONLY via public.update_own_full_name() RPC
 * - Role/status/company_id/employee_id changes ONLY via service role
 * 
 * USER SELF-SERVICE (authenticated users):
 * ========================================
 * - Users CAN read their own profile (profiles_select_own)
 * - Users CAN read other profiles in their company (profiles_select_company)
 * - Users CAN update only their own full_name (public.update_own_full_name)
 * - Users CANNOT change their own role (no policy allows it)
 * - Users CANNOT change their own status (no policy allows it)
 * - Users CANNOT change their own company_id (no policy allows it)
 * - Users CANNOT change their own employee_id (no policy allows it)
 * - Users CANNOT INSERT/UPDATE/DELETE profiles (policies = false)
 * 
 * STATUS ENFORCEMENT:
 * ==================
 * - ALL policies require private.is_active_user() = true
 * - Inactive users cannot query ANY table
 * - Suspended users cannot query ANY table
 * - Status changes require service role (authenticated clients cannot modify)
 * - Only service role + administrative process can change status
 * 
 * COMPANY ISOLATION:
 * ==================
 * - Employees can only see their own company's data via RLS
 * - Super_admin sees all companies
 * - Users cannot escalate/change company via any interface (UPDATE policy blocks, no INSERT)
 * - Cross-company access prevented at database level (RLS)
 * 
 * RECURSIVE RLS PREVENTION:
 * =========================
 * - Helper functions use SECURITY DEFINER + set search_path = ''
 * - Policies use helper functions, not direct SELECT from profiles
 * - No policy queries public.profiles in a way that triggers RLS recursion
 * - Avoids infinite recursion / RLS evaluation loops
 * 
 * DATA API PROTECTION:
 * ====================
 * - private schema: revoke CREATE from anon and authenticated
 * - Only RLS policies control data access
 * - Authentication enforced at auth.uid() level
 * 
 * IDEMPOTENCY:
 * ============
 * - All DROP POLICY statements included
 * - All CREATE OR REPLACE for functions
 * - All CREATE TABLE IF NOT EXISTS
 * - All CREATE INDEX IF NOT EXISTS
 * - Safe to rerun without manual cleanup
 */

-- MANUAL SETUP STEPS (see DEPLOYMENT_GUIDE.md for detailed instructions):
-- 1. Execute this entire SQL script in Supabase SQL Editor
-- 2. Verify: private schema created, 5 functions exist, update_own_full_name exists, RLS policies on 5 tables
-- 3. Create auth user via Supabase console (email + password)
-- 4. Copy user UUID
-- 5. Insert profile via service role (SQL Editor, with user UUID from step 4)
-- 6. User logs in at /login
-- 7. On first login, checks profile exists and status='active'
-- 8. If profile active, user can:
--    - View own profile and company data
--    - Update own full_name via public.update_own_full_name('new name')
--    - See role/status/company_id in dashboard
-- 9. Cannot change role/status/company_id (RLS prevents it)

COMMIT;
