# Brain Phase 1 Authentication & Access Control Setup Guide

**IMPORTANT**: This schema has been completely rewritten for security. Please read [AUTH_SECURITY_REWRITE.md](./AUTH_SECURITY_REWRITE.md) first.

## Security Model Overview

The new `auth_schema.sql` implements:

- ✅ **No recursive RLS** - Uses SECURITY DEFINER helper functions
- ✅ **Status enforcement** - Only active users can access data
- ✅ **Company isolation** - Employees see only their company
- ✅ **Immutable profiles** - Users cannot change their own role/status/company
- ✅ **Super admin only** - Only super_admin can create/manage companies

See [AUTH_SECURITY_REWRITE.md](./AUTH_SECURITY_REWRITE.md) for complete security details.

## Prerequisites

- [ ] Brain database is deployed on Supabase
- [ ] All schema files have been applied:
  - `companies_schema.sql`
  - `locations_schema.sql`
  - `departments_schema.sql`
  - `employees_schema.sql`
  - `auth_schema.sql` (NEW)
- [ ] You have access to the Supabase project console
- [ ] You have access to create records in the companies and employees tables

## Step 1: Apply auth_schema.sql

1. Go to your Supabase project console
2. Navigate to SQL Editor
3. Create a new query
4. Copy the entire contents of `auth_schema.sql` and paste it into the SQL editor
5. Click "Run" to apply the schema
6. Verify all statements executed successfully (no errors)

This creates:
- `profiles` table with RLS policies
- RLS policies on all tables (companies, locations, departments, employees)
- Performance indexes

## Step 2: Create First Super Admin User

### Option A: Via Supabase Auth Console (Recommended for Initial Setup)

1. Go to your Supabase project → Authentication → Users
2. Click "Add user" → "Create new user"
3. Enter email and password:
   - Email: (your admin email, e.g., `admin@example.com`)
   - Password: (strong password)
   - Uncheck "Auto send sign-up confirmation email" (you'll manage manually)
4. Click "Create user"
5. Copy the user ID (UUID) for the next step

### Option B: Via API (for automated setup)

Use this curl command:

```bash
curl -X POST 'https://YOUR_PROJECT_ID.supabase.co/auth/v1/admin/users' \
  -H 'apikey: YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@example.com",
    "password": "YourStrongPassword123",
    "email_confirm": true
  }'
```

The response will include the user ID (UUID).

## Step 3: Ensure Your Initial Data Exists

Before creating the profile, verify you have:

1. **A company** (for the owner to belong to)
   - Go to your Supabase project → SQL Editor
   - Run this to see existing companies:
     ```sql
     select id, name from public.companies limit 5;
     ```
   - Copy the company ID for "Rikky'z" (or your company name)

2. **An employee record** (optional, but recommended for owner)
   - Run this to see existing employees:
     ```sql
     select id, first_name, last_name, email from public.employees limit 5;
     ```
   - Find the employee ID for Michael Hmouda (or your admin employee)
   - If not exists, insert one:
     ```sql
     insert into public.employees (
       company_id, 
       first_name, 
       last_name, 
       email, 
       role, 
       employment_type, 
       status
     ) values (
       'COMPANY_ID_HERE',
       'Michael',
       'Hmouda',
       'admin@example.com',
       'Owner',
       'Full-time',
       'active'
     ) returning id;
     ```

## Step 4: Create the First Profile

### Using the Supabase Console (Recommended)

1. Go to Supabase project → SQL Editor
2. Create a new query
3. Run this SQL (replace placeholders):

```sql
-- Create the super_admin profile
-- This user will have access to all companies
insert into public.profiles (
  id,
  company_id,
  employee_id,
  full_name,
  role,
  status
) values (
  'AUTH_USER_ID_HERE',     -- from Step 2
  'COMPANY_ID_HERE',       -- from Step 3 (or NULL for super_admin access to all)
  'EMPLOYEE_ID_HERE',      -- from Step 3 (optional)
  'Michael Hmouda',        -- user's full name
  'owner',                 -- role: 'super_admin' | 'owner' | 'manager' | 'employee'
  'active'                 -- status: 'active' | 'inactive' | 'suspended'
);
```

### Example for Rikky'z Company Setup

```sql
-- First, verify the company and employee IDs
select id from public.companies where name = 'Rikky''z';
select id from public.employees where email = 'admin@example.com';

-- Then create the profile
insert into public.profiles (
  id,
  company_id,
  employee_id,
  full_name,
  role,
  status
) values (
  '11111111-1111-1111-1111-111111111111',  -- replace with actual auth user ID
  '22222222-2222-2222-2222-222222222222',  -- replace with Rikky'z company ID
  '33333333-3333-3333-3333-333333333333',  -- replace with Michael's employee ID
  'Michael Hmouda',
  'owner',
  'active'
);
```

4. Click "Run" and verify: "Successfully inserted 1 row"

## Step 5: Test the Login

1. Go to your Brain application: `https://your-domain/login`
2. Enter the email and password from Step 2
3. You should be redirected to `/dashboard`
4. Verify the sidebar shows:
   - Your email
   - Your role badge (Owner)
   - Your company name (if applicable)
   - Sign out button

## Step 6: Create Additional Users

For each additional user, repeat Steps 2-4 with appropriate roles:

### Owner Role
- Can create and edit all operational data (locations, departments, employees)
- Can view company settings
- Cannot manage users (yet - future feature)

```sql
insert into public.profiles (
  id, company_id, full_name, role, status
) values (
  'USER_ID',
  'COMPANY_ID',
  'John Owner',
  'owner',
  'active'
);
```

### Manager Role
- Can create and edit operational data
- Cannot view/edit company settings
- Cannot manage other users

```sql
insert into public.profiles (
  id, company_id, full_name, role, status
) values (
  'USER_ID',
  'COMPANY_ID',
  'Jane Manager',
  'manager',
  'active'
);
```

### Employee Role
- Read-only access initially
- Can view their own profile
- Cannot modify data

```sql
insert into public.profiles (
  id, company_id, full_name, role, status
) values (
  'USER_ID',
  'COMPANY_ID',
  'Bob Employee',
  'employee',
  'active'
);
```

### Super Admin Role
- Access to ALL companies
- Can manage all users
- Set `company_id` to NULL

```sql
insert into public.profiles (
  id, full_name, role, status
) values (
  'USER_ID',
  'Super Admin',
  'super_admin',
  'active'
);
```

## Step 7: Verify RLS is Working

1. Create a second user in a different company:
   - Create an auth user (Step 2)
   - Create a profile with a different company_id

2. Test that users can only see their own company's data:
   - Open an incognito window
   - Log in as the second user
   - Navigate to `/dashboard/companies`
   - Should only see companies they have access to
   - Cannot see other company's data

## Disabling a User Account

To temporarily disable a user without deleting them:

```sql
update public.profiles
set status = 'inactive'
where id = 'USER_ID_HERE';
```

The user will see: "Your account is inactive. Please contact your administrator."

## Emergency: Bypass First Login Setup

If you need to create a profile via SQL without going through the email confirmation:

1. Create user in Auth (Step 2)
2. Create profile (Step 4)
3. The user can now log in immediately with their email/password

## Troubleshooting

### "Account not set up yet" Error
- **Cause**: Profile record does not exist for the user
- **Fix**: Run Step 4 to create the profile

### "Account is inactive" Error
- **Cause**: Profile status is not 'active'
- **Fix**: Update the profile: `update public.profiles set status = 'active' where id = 'USER_ID'`

### Cannot see data in dashboard
- **Cause**: RLS policies are preventing access (working as intended)
- **Fix**: Verify the user's company_id matches the data they're trying to view
- **Verify**: Check the profile query: `select * from public.profiles where id = 'USER_ID'`

### "Failed to sign in" Error
- **Cause**: Invalid email/password combination
- **Fix**: Verify credentials match what was set in Step 2

### User can see other company's data
- **Cause**: RLS policies not applied correctly
- **Fix**: Re-run auth_schema.sql to ensure all policies are created

## Security Checklist

- [ ] SUPABASE_SERVICE_ROLE_KEY is NOT exposed in client code
- [ ] All /dashboard routes require authentication (middleware enforced)
- [ ] RLS is enabled on all tables
- [ ] Password reset links expire after 1 hour
- [ ] All user sessions are server-side (not stored client-side)
- [ ] Each user belongs to exactly one company
- [ ] Super admin can only be created via SQL (not UI signup)

## Next Steps (Phase 2)

- User management interface (create/edit/disable users)
- Email confirmations and invitations
- Two-factor authentication
- Password expiration policies
- Audit logging
- Role-based permissions UI

## Questions?

For more information, see:
- `auth_schema.sql` - Database schema and RLS policies
- `lib/auth.ts` - Client-side authentication functions
- `lib/authServer.ts` - Server-side authentication functions
- `middleware.ts` - Route protection
