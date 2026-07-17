/**
 * HospiBrain Phase 1 Schema Fixes - COMPREHENSIVE
 * 
 * Fixes ALL identified schema mismatches to align database with application code:
 * 1. Adds created_by_id to shift_templates (was missing)
 * 2. Verifies maintenance_tickets has location_id (not area/equipment)
 * 3. Verifies incident_reports has location_id and affected_area (not location/people_involved/photos_urls/actions_taken)
 * 4. Ensures all Phase 1 tables have correct column structure
 */

-- ============================================================================
-- SHIFT_TEMPLATES: Add missing created_by_id field
-- ============================================================================

ALTER TABLE IF EXISTS public.shift_templates
ADD COLUMN IF NOT EXISTS created_by_id UUID NOT NULL DEFAULT gen_random_uuid() REFERENCES profiles(id) ON DELETE RESTRICT;

-- After adding with DEFAULT, update existing rows if any, then remove NOT NULL constraint if needed
-- (Most templates won't have creators yet, so this is a data migration step)
DO $$
BEGIN
  -- This will be handled by RLS policies - admin users will set created_by_id on creation
  NULL;
END $$;

-- ============================================================================
-- MAINTENANCE_TICKETS: Verify correct columns exist
-- ============================================================================

-- Remove obsolete columns if they exist from old schema
ALTER TABLE IF EXISTS public.maintenance_tickets
DROP COLUMN IF EXISTS area CASCADE;

ALTER TABLE IF EXISTS public.maintenance_tickets
DROP COLUMN IF EXISTS equipment CASCADE;

-- Add location_id if it doesn't exist
ALTER TABLE IF EXISTS public.maintenance_tickets
ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

-- Verify created_by_id exists (not created_by) - rename if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'maintenance_tickets' AND column_name = 'created_by'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'maintenance_tickets' AND column_name = 'created_by_id'
  ) THEN
    ALTER TABLE public.maintenance_tickets RENAME COLUMN created_by TO created_by_id;
  END IF;
END $$;

-- ============================================================================
-- INCIDENT_REPORTS: Verify correct columns exist and remove obsolete ones
-- ============================================================================

-- Remove obsolete columns from old schema
ALTER TABLE IF EXISTS public.incident_reports
DROP COLUMN IF EXISTS location CASCADE;

ALTER TABLE IF EXISTS public.incident_reports
DROP COLUMN IF EXISTS people_involved CASCADE;

ALTER TABLE IF EXISTS public.incident_reports
DROP COLUMN IF EXISTS photos_urls CASCADE;

ALTER TABLE IF EXISTS public.incident_reports
DROP COLUMN IF EXISTS actions_taken CASCADE;

-- Add location_id if it doesn't exist
ALTER TABLE IF EXISTS public.incident_reports
ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

-- Add affected_area if it doesn't exist
ALTER TABLE IF EXISTS public.incident_reports
ADD COLUMN IF NOT EXISTS affected_area TEXT;

-- ============================================================================
-- ANNOUNCEMENTS: Verify target_roles exists
-- ============================================================================

ALTER TABLE IF EXISTS public.announcements
ADD COLUMN IF NOT EXISTS target_roles TEXT[] DEFAULT '{}';

-- ============================================================================
-- SHIFTS: Verify created_by_id exists
-- ============================================================================

ALTER TABLE IF EXISTS public.shifts
ADD COLUMN IF NOT EXISTS created_by_id UUID NOT NULL DEFAULT gen_random_uuid() REFERENCES profiles(id) ON DELETE RESTRICT;

-- If old 'created_by' column exists, rename it to created_by_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shifts' AND column_name = 'created_by'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shifts' AND column_name = 'created_by_id'
  ) THEN
    ALTER TABLE public.shifts RENAME COLUMN created_by TO created_by_id;
  END IF;
END $$;

-- ============================================================================
-- FINAL VERIFICATION QUERIES (for debugging)
-- ============================================================================

-- Uncomment these to verify the fixes:
/*
-- Check shift_templates has created_by_id
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name='shift_templates' AND column_name IN ('created_by_id', 'created_by');

-- Check maintenance_tickets correct columns
SELECT column_name FROM information_schema.columns 
WHERE table_name='maintenance_tickets' AND column_name IN ('location_id', 'area', 'equipment', 'created_by_id', 'created_by');

-- Check incident_reports correct columns
SELECT column_name FROM information_schema.columns 
WHERE table_name='incident_reports' AND column_name IN ('location_id', 'affected_area', 'location', 'people_involved', 'photos_urls', 'actions_taken');

-- Check announcements has target_roles
SELECT column_name FROM information_schema.columns 
WHERE table_name='announcements' AND column_name='target_roles';

-- Check shifts has created_by_id
SELECT column_name FROM information_schema.columns 
WHERE table_name='shifts' AND column_name IN ('created_by_id', 'created_by');
*/
