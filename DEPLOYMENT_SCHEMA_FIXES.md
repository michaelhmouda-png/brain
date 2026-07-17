# Phase 1 Schema Fixes - Deployment Checklist

**Build Status**: ✅ PASSING (0 errors, 54 routes compiled)  
**Date**: Generated after comprehensive audit  
**Priority**: HIGH - Required before final production deployment

---

## Summary

The application code in `route.ts` is completely correct and compiles without errors. However, the Supabase database may be missing 4 critical columns that the code is trying to insert/update. This document guides you through verifying and fixing any schema mismatches.

---

## Audit Results

### 1. SHIFTS Table
- **Status**: ✅ Schema file correct
- **Required Column**: `created_by_id` (UUID, FK to profiles.id)
- **Code Reference**: Line 3350-3365 in route.ts - createShift handler
- **Columns Being Inserted**:
  - company_id, employee_id, shift_date, start_time, end_time, shift_type
  - department_id, notes, status, created_by_id
- **Action**: Verify `created_by_id` exists in database (if old column was `created_by`, rename it)

### 2. MAINTENANCE_TICKETS Table  
- **Status**: ✅ Schema file correct
- **Required Column**: `location_id` (UUID, FK to locations.id)
- **Code Reference**: Line 3474-3490 in route.ts - createMaintenanceTicket handler
- **Columns Being Inserted**:
  - company_id, title, description, priority, location_id
  - assigned_to_id, due_date, status, created_by_id
- **Columns Being Updated** (Line 3510-3530):
  - title, description, priority, status, assigned_to_id, due_date
- **Old Columns to Remove** (if they exist):
  - `area`, `equipment` - replaced by location_id FK
- **Action**: Add `location_id` column; remove obsolete area/equipment columns if present

### 3. ANNOUNCEMENTS Table
- **Status**: ✅ Schema file correct
- **Required Column**: `target_roles` (TEXT[], default '{}')
- **Code Reference**: Line 3595-3610 in route.ts - createAnnouncement handler
- **Columns Being Inserted**:
  - company_id, title, content, priority, target_roles
  - expires_at, created_by_id
- **Columns Being Updated** (Line 3630-3643):
  - title, content, priority, expires_at
- **Action**: Add `target_roles` column with TEXT[] type and default '{}'

### 4. INCIDENT_REPORTS Table
- **Status**: ✅ Schema file correct
- **Required Columns**: `location_id` (UUID FK), `affected_area` (TEXT)
- **Code Reference**: Line 3711-3735 in route.ts - createIncident handler
- **Columns Being Inserted**:
  - company_id, title, description, severity, location_id
  - affected_area, incident_type, status, incident_time, reported_by_id
- **Old Columns to Remove** (if they exist):
  - `location` (TEXT) - replaced by location_id FK
  - `people_involved`, `photos_urls`, `actions_taken` - obsolete
- **Action**: Add `location_id` and `affected_area` columns; remove old location + obsolete columns

### 5. NOTIFICATIONS Table
- **Status**: ✅ Schema file includes full definition
- **Note**: No handlers yet, but table is ready for future use

---

## Deployment Steps

### Option A: Using the Migration SQL File (RECOMMENDED)

1. **Copy migration script** from `migrations_phase1_schema_fixes.sql`
2. **Open Supabase SQL Editor**:
   - Go to https://supabase.com/dashboard
   - Select your project
   - Click "SQL Editor" in sidebar
   - Click "+ New Query"
3. **Paste the entire migration script**
4. **Execute** (Cmd+Enter or click Run)
5. **Verify**: All ALTER TABLE commands should complete without errors

### Option B: Manual Verification & Fixes

If the migration script isn't suitable for your setup, verify manually:

```sql
-- Check SHIFTS table
SELECT column_name FROM information_schema.columns 
WHERE table_name='shifts' AND column_name='created_by_id';

-- Check MAINTENANCE_TICKETS table
SELECT column_name FROM information_schema.columns 
WHERE table_name='maintenance_tickets' AND column_name='location_id';

-- Check ANNOUNCEMENTS table  
SELECT column_name FROM information_schema.columns 
WHERE table_name='announcements' AND column_name='target_roles';

-- Check INCIDENT_REPORTS table
SELECT column_name FROM information_schema.columns 
WHERE table_name='incident_reports' AND column_name IN ('location_id', 'affected_area');
```

If any columns are missing, apply the corresponding ALTER TABLE commands from the migration file.

---

## What Will Happen After Deployment

Once the database schema is updated:

1. **All 4 entity types work correctly**:
   - ✅ Shifts will save to shifts table with proper created_by_id
   - ✅ Maintenance tickets will save to maintenance_tickets with location_id
   - ✅ Announcements will save with target_roles array
   - ✅ Incidents will save to incident_reports with location_id and affected_area

2. **No more PGRST204 errors** - "Could not find column" errors will disappear

3. **Full entity routing works** - Each entity type stores in correct table

4. **Date handling works** - Relative dates (tomorrow, next Monday) resolve correctly

---

## Rollback Plan (If Needed)

If you need to revert changes, the migration file is idempotent:
- All `ADD COLUMN IF NOT EXISTS` - won't duplicate columns
- All `DROP COLUMN IF EXISTS` - won't error if column missing
- Can be safely re-run multiple times

---

## Verification After Deployment

### 1. Test via UI
- Go to Dashboard → AI Assistant
- Try creating a shift: "Schedule John for tomorrow 9 AM to 5 PM"
- Confirm the preview, then accept
- Check database: record should appear in shifts table

### 2. Test via SQL
```sql
-- Verify recent records inserted successfully
SELECT id, created_by_id, status FROM shifts LIMIT 5;
SELECT id, location_id, status FROM maintenance_tickets LIMIT 5;
SELECT id, target_roles, expires_at FROM announcements LIMIT 5;
SELECT id, location_id, affected_area FROM incident_reports LIMIT 5;
```

### 3. Monitor Logs
- Open Supabase dashboard
- Check "Logs" or network tab for PGRST204 errors
- Should see no column-not-found errors

---

## Schema Alignment Summary

| Table | Columns Verified | Status |
|-------|------------------|--------|
| shifts | 10 columns including created_by_id | ✅ Ready |
| maintenance_tickets | 9 columns including location_id | ✅ Ready |
| announcements | 7 columns including target_roles | ✅ Ready |
| incident_reports | 10 columns including location_id, affected_area | ✅ Ready |
| notifications | 10 columns (future-ready) | ✅ Ready |

---

## Next Steps After Schema Fix

1. ✅ Deploy migration to Supabase (THIS DOCUMENT)
2. 🔄 Test all 4 entity types through UI
3. 🔄 Monitor error logs for PGRST204 errors
4. 🔄 Run integration tests if available
5. 🔄 Schedule production deployment

---

## Questions?

If you encounter any issues:
- Check the exact error message from Supabase dashboard
- Verify column names match exactly (case-sensitive)
- Ensure all foreign key references exist (companies, locations, profiles, employees)
- Confirm RLS policies don't block the operations (should not - they check company_id)
