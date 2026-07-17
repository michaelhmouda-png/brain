ALTER TABLE IF EXISTS public.shift_templates
ADD COLUMN IF NOT EXISTS created_by_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.maintenance_tickets
DROP COLUMN IF EXISTS area CASCADE;

ALTER TABLE IF EXISTS public.maintenance_tickets
DROP COLUMN IF EXISTS equipment CASCADE;

ALTER TABLE IF EXISTS public.maintenance_tickets
ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'maintenance_tickets' AND column_name = 'created_by'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'maintenance_tickets' AND column_name = 'created_by_id'
  ) THEN
    ALTER TABLE public.maintenance_tickets RENAME COLUMN created_by TO created_by_id;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.incident_reports
DROP COLUMN IF EXISTS location CASCADE;

ALTER TABLE IF EXISTS public.incident_reports
DROP COLUMN IF EXISTS people_involved CASCADE;

ALTER TABLE IF EXISTS public.incident_reports
DROP COLUMN IF EXISTS photos_urls CASCADE;

ALTER TABLE IF EXISTS public.incident_reports
DROP COLUMN IF EXISTS actions_taken CASCADE;

ALTER TABLE IF EXISTS public.incident_reports
ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.incident_reports
ADD COLUMN IF NOT EXISTS affected_area TEXT;

ALTER TABLE IF EXISTS public.announcements
ADD COLUMN IF NOT EXISTS target_roles TEXT[] DEFAULT '{}';

ALTER TABLE IF EXISTS public.shifts
ADD COLUMN IF NOT EXISTS created_by_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'shifts' AND column_name = 'created_by'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'shifts' AND column_name = 'created_by_id'
  ) THEN
    ALTER TABLE public.shifts RENAME COLUMN created_by TO created_by_id;
  END IF;
END $$;
