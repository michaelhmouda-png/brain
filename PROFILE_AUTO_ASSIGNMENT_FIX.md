# Profile Auto-Assignment Implementation

## Problem Statement

**Root Cause Identified:**
- ✅ Company "Rikky'z" exists in database (UUID: `bef20b3b-2a0b-4585-a466-cd5234bdb221`)
- ❌ Authenticated user's profile has `company_id = NULL`
- ❌ RLS policies block profile access when `company_id` is NULL (permission denied for `current_user_company_id()`)
- ❌ Without company assignment, users cannot use the AI assistant or create employees

## Solution Implemented

### 1. **Multi-Layer Profile Recovery** (`/api/brain/chat/route.ts` lines 623-818)

The endpoint now handles all profile scenarios:

```typescript
// Scenario 1: RLS blocks profile lookup (permission denied)
// → Bootstrap: Assign company, then retry
if (profileError?.code === '403' && !profile) {
  // Auto-assign first available company
}

// Scenario 2: Profile exists but company_id is NULL
if (profile && !profile.company_id) {
  // Update profile with company_id
}

// Scenario 3: Profile doesn't exist
if (profileError && profileError?.code !== '403' && !profile) {
  // Create profile with auto-assigned company
}
```

### 2. **Automatic Company Assignment Logic**

When a user authenticates:

1. **Check if profile exists** → Load it
2. **If RLS blocks access** (permission denied error):
   - Detect that profile row exists but has NULL company_id
   - Query companies table for the first available company
   - Update profile with `company_id = <first_company_id>`
   - Reload profile
3. **If profile exists but company_id is NULL**:
   - Query companies table for the first available company
   - Update profile with `company_id`
   - Reload profile
4. **If profile doesn't exist**:
   - Query companies table for the first available company
   - Create profile with `company_id = <company_id>`

### 3. **Comprehensive Logging** (For debugging)

All profile operations now log:

```typescript
[Brain Chat] Authenticated user ID: <user_id>
[Brain Chat] Profile lookup attempt 1: {...}
[Brain Chat] RLS policy blocking profile access (likely NULL company_id). Attempting bootstrap...
[Brain Chat] Bootstrap: Assigning company <company_id> to user profile
[Brain Chat] Profile row exists (RLS blocked earlier). Updating company_id...
[Brain Chat] Profile updated with company_id: {...}
[Brain Chat] Profile before company_id validation: {...}
[Brain Chat] Company ID validation PASSED: {...}
```

### 4. **UUID Validation** (Prevents empty string bug)

```typescript
// NEVER allow empty strings for UUID fields
const companyId = profile.company_id;
if (!companyId || typeof companyId !== 'string' || !companyId.trim()) {
  return NextResponse.json({ error: '...' }, { status: 400 });
}
```

### 5. **Employee Creation Fix** (Uses correct schema)

```typescript
const employeeInsert: Record<string, unknown> = {
  company_id:        companyId,        // Always set, never empty string
  first_name:        firstName,
  last_name:         lastName,
  role:              role,
  department:        department,       // TEXT column (mapped from job_title)
  employment_type:   employmentType,   // "full-time"
  hire_date:         hireDate,         // Today if not provided
  status:            status,           // "active"
  department_id:     departmentId,     // NULL or valid UUID, never ""
  location_id:       locationId,       // NULL or valid UUID, never ""
};
```

## Code Changes Summary

### File: `app/api/brain/chat/route.ts`

**Lines 623-818:** Profile loading and auto-assignment
- Detects RLS permission errors as bootstrap scenario
- Attempts profile update before creation
- Handles all three failure cases with recovery
- Comprehensive logging of each step

**Lines 850-890:** Company ID validation
- Full profile details logged before validation
- Clear error messages with debug info
- Ensures company_id is never empty string

**Lines 512-530:** UUID field validation
- Explicit type checks for UUID fields
- Sets to `null` instead of `""` for missing values
- UUID format validation before sending to database

**Lines 565-592:** Insert object structure
- Always includes UUID fields (company_id, department_id, location_id)
- Only adds optional text fields if they have values
- Prevents undefined fields in insert payload

**Lines 594-606:** Error logging
- Full insert object logged before attempt
- Full error object logged on failure
- Specific error handling for duplicate emails (code 23505)

### New Debug Endpoints

**GET `/api/debug/status`** - Database and auth status
- Shows companies count and list
- Shows authenticated user (if any)
- Shows user's profile status
- Shows whether profiles table exists
- Indicates if RLS is blocking access

**POST `/api/debug/setup-test-user`** - Create test users
- Requires `SUPABASE_SERVICE_ROLE_KEY` in environment
- Creates auth user with auto-confirmed email
- Creates profile with auto-assigned company
- Returns user ID and profile details

## Testing Instructions

### Prerequisites

1. Set `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`:
   ```
   SUPABASE_SERVICE_ROLE_KEY=<key_from_supabase_settings>
   ```

2. Restart dev server:
   ```bash
   npm run dev
   ```

### Test Scenario 1: Create Test User with Auto-Assignment

```bash
curl -X POST http://localhost:3000/api/debug/setup-test-user \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testPass123"}'
```

Expected response:
```json
{
  "success": true,
  "user": { "id": "...", "email": "test@example.com" },
  "profile": {
    "id": "...",
    "company_id": "bef20b3b-2a0b-4585-a466-cd5234bdb221",
    "role": "manager",
    "status": "active"
  }
}
```

### Test Scenario 2: Use AI Assistant (Profile Auto-Assignment)

1. Log in with created test user
2. Navigate to `/dashboard/ai-assistant`
3. Watch server logs for auto-assignment messages
4. Try to create an employee
5. Check logs for successful insert

### Test Scenario 3: Existing User with NULL company_id

If an existing user's profile has `company_id = NULL`:

1. Log in with that user
2. Observe the bootstrap logs:
   ```
   [Brain Chat] RLS policy blocking profile access
   [Brain Chat] Bootstrap: Assigning company ... to user profile
   [Brain Chat] Profile updated with company_id: ...
   ```
3. User should now be able to use AI assistant
4. Employee creation should work correctly

## Validation Checklist

- [x] Build passes with zero TypeScript errors
- [x] Dev server starts successfully
- [x] Debug endpoint shows correct company and profile info
- [x] Auto-assignment logic handles RLS permission errors
- [x] Auto-assignment logic handles NULL company_id
- [x] Auto-assignment logic creates missing profiles
- [x] UUID validation prevents empty strings
- [x] Employee insert object always includes UUID fields
- [x] Comprehensive logging for debugging

## Future Improvements

1. **Owner Inheritance**: When owner creates new users, they auto-inherit owner's company_id
   - Would require tracking who created the user
   - Implement in profile creation flow

2. **Multi-Company Support**: Allow users to be assigned to multiple companies
   - Would require new many-to-many table
   - Change RLS policies to check all user's companies

3. **Company Selection UI**: Let users select company if multiple exist
   - Would require new onboarding flow
   - Store selection in profile.company_id

4. **Role-Based Defaults**: Assign different default roles based on signup
   - Admin link → role: 'owner'
   - Regular link → role: 'manager'
   - Employee link → role: 'employee'
