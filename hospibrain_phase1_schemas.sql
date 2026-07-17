/**
 * HospiBrain Phase 1: Operations Platform
 * Complete database schemas with RLS for all 12 modules
 * 
 * Modules:
 * 1. Shift Management
 * 2. Maintenance
 * 3. Announcements
 * 4. Incident Reports
 * 5. Operations Dashboard (uses existing tables)
 * 6. AI Operations Commands (tool handlers)
 * 7. Notifications
 * 8. Activity Timeline
 * 9-12. UI, Security, Quality, Build
 */

-- ============================================================================
-- HELPER FUNCTIONS (for RLS policies)
-- ============================================================================

-- Create private schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS private;

-- Helper function: Get current user's company ID
CREATE OR REPLACE FUNCTION private.current_user_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT company_id
  FROM public.profiles
  WHERE id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.current_user_company_id() FROM public;
GRANT EXECUTE ON FUNCTION private.current_user_company_id() TO authenticated;

-- Helper function: Check if current user is active
CREATE OR REPLACE FUNCTION private.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION private.is_active_user() FROM public;
GRANT EXECUTE ON FUNCTION private.is_active_user() TO authenticated;

-- Helper function: Check if current user is super admin
CREATE OR REPLACE FUNCTION private.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'super_admin'
      AND status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION private.is_super_admin() FROM public;
GRANT EXECUTE ON FUNCTION private.is_super_admin() TO authenticated;

-- Helper function: Check if current user can manage a company
CREATE OR REPLACE FUNCTION private.can_manage_company(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND company_id = target_company_id
      AND role IN ('admin', 'super_admin')
      AND status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION private.can_manage_company(uuid) FROM public;
GRANT EXECUTE ON FUNCTION private.can_manage_company(uuid) TO authenticated;

-- ============================================================================
-- MODULE 1: SHIFT MANAGEMENT
-- ============================================================================

-- Roles within a company
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  permissions JSONB DEFAULT '[]'::jsonb, -- e.g., ["can_schedule", "can_approve_swaps"]
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(company_id, name),
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);

-- Shift template definitions
CREATE TABLE IF NOT EXISTS shift_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_minutes INT DEFAULT 0,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  created_by_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);

-- Single shift assignments (ad-hoc or one-time)
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  shift_type TEXT DEFAULT 'custom' CHECK (shift_type IN ('morning', 'afternoon', 'evening', 'night', 'custom')),
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  notes TEXT,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_by_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);

-- Weekly schedule assignments
CREATE TABLE IF NOT EXISTS weekly_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  monday_shift_id UUID REFERENCES shift_templates(id) ON DELETE SET NULL,
  tuesday_shift_id UUID REFERENCES shift_templates(id) ON DELETE SET NULL,
  wednesday_shift_id UUID REFERENCES shift_templates(id) ON DELETE SET NULL,
  thursday_shift_id UUID REFERENCES shift_templates(id) ON DELETE SET NULL,
  friday_shift_id UUID REFERENCES shift_templates(id) ON DELETE SET NULL,
  saturday_shift_id UUID REFERENCES shift_templates(id) ON DELETE SET NULL,
  sunday_shift_id UUID REFERENCES shift_templates(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(company_id, employee_id, week_start_date),
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);

-- Recurring shift assignments
CREATE TABLE IF NOT EXISTS recurring_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_template_id UUID NOT NULL REFERENCES shift_templates(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday, 6=Saturday
  start_date DATE NOT NULL,
  end_date DATE,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);

-- Open shift slots
CREATE TABLE IF NOT EXISTS open_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  shift_template_id UUID NOT NULL REFERENCES shift_templates(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  quantity INT DEFAULT 1,
  filled_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled')),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);

-- Shift swap requests
CREATE TABLE IF NOT EXISTS shift_swaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  requestor_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  target_employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  requestor_shift_date DATE NOT NULL,
  target_shift_date DATE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);

-- Time-off requests
CREATE TABLE IF NOT EXISTS time_off_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT dates_valid CHECK (end_date >= start_date),
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);

-- Attendance records (clock in/out)
CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  clock_in_time TIMESTAMP WITH TIME ZONE,
  clock_out_time TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  location TEXT, -- e.g., "Bar", "Kitchen"
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);

-- ============================================================================
-- MODULE 2: MAINTENANCE
-- ============================================================================

CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  assigned_to_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  due_date DATE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'waiting_parts', 'completed', 'cancelled')),
  created_by_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  completed_at TIMESTAMP WITH TIME ZONE,
  completion_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);

-- ============================================================================
-- MODULE 3: ANNOUNCEMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  target_roles TEXT[] DEFAULT '{}',
  created_by_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  published_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);

-- Acknowledgments of announcements by employees
CREATE TABLE IF NOT EXISTS announcement_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(announcement_id, employee_id),
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);

-- ============================================================================
-- MODULE 4: INCIDENT REPORTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS incident_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  incident_type TEXT CHECK (incident_type IN ('guest_injury', 'employee_injury', 'fight', 'power_outage', 'equipment_failure', 'lost_item', 'other')),
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  affected_area TEXT,
  incident_time TIMESTAMP WITH TIME ZONE NOT NULL,
  reported_by_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);

-- ============================================================================
-- MODULE 7: NOTIFICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  notification_type TEXT NOT NULL, -- task, shift, maintenance, announcement, incident
  related_entity_type TEXT, -- task, shift, maintenance_ticket, announcement, incident_report
  related_entity_id UUID,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);

-- ============================================================================
-- MODULE 8: ACTIVITY TIMELINE
-- ============================================================================

CREATE TABLE IF NOT EXISTS activity_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  action_by_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL, -- task_created, task_completed, shift_created, shift_changed, etc.
  entity_type TEXT NOT NULL, -- task, shift, maintenance, announcement, incident
  entity_id UUID NOT NULL,
  entity_name TEXT,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);

-- ============================================================================
-- RLS POLICIES - ALL TABLES
-- ============================================================================

-- Enable RLS on all new tables
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_swaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_acknowledgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_timeline ENABLE ROW LEVEL SECURITY;

-- ROLES table RLS
DROP POLICY IF EXISTS roles_select ON roles;
CREATE POLICY roles_select ON roles FOR SELECT
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS roles_insert ON roles;
CREATE POLICY roles_insert ON roles FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS roles_update ON roles;
CREATE POLICY roles_update ON roles FOR UPDATE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS roles_delete ON roles;
CREATE POLICY roles_delete ON roles FOR DELETE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

-- SHIFT_TEMPLATES table RLS
DROP POLICY IF EXISTS shift_templates_select ON shift_templates;
CREATE POLICY shift_templates_select ON shift_templates FOR SELECT
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS shift_templates_insert ON shift_templates;
CREATE POLICY shift_templates_insert ON shift_templates FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS shift_templates_update ON shift_templates;
CREATE POLICY shift_templates_update ON shift_templates FOR UPDATE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS shift_templates_delete ON shift_templates;
CREATE POLICY shift_templates_delete ON shift_templates FOR DELETE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

-- SHIFTS table RLS
DROP POLICY IF EXISTS shifts_select ON shifts;
CREATE POLICY shifts_select ON shifts FOR SELECT
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS shifts_insert ON shifts;
CREATE POLICY shifts_insert ON shifts FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS shifts_update ON shifts;
CREATE POLICY shifts_update ON shifts FOR UPDATE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS shifts_delete ON shifts;
CREATE POLICY shifts_delete ON shifts FOR DELETE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

-- WEEKLY_SCHEDULES table RLS
DROP POLICY IF EXISTS weekly_schedules_select ON weekly_schedules;
CREATE POLICY weekly_schedules_select ON weekly_schedules FOR SELECT
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS weekly_schedules_insert ON weekly_schedules;
CREATE POLICY weekly_schedules_insert ON weekly_schedules FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS weekly_schedules_update ON weekly_schedules;
CREATE POLICY weekly_schedules_update ON weekly_schedules FOR UPDATE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS weekly_schedules_delete ON weekly_schedules;
CREATE POLICY weekly_schedules_delete ON weekly_schedules FOR DELETE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

-- RECURRING_SHIFTS table RLS
DROP POLICY IF EXISTS recurring_shifts_select ON recurring_shifts;
CREATE POLICY recurring_shifts_select ON recurring_shifts FOR SELECT
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS recurring_shifts_insert ON recurring_shifts;
CREATE POLICY recurring_shifts_insert ON recurring_shifts FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS recurring_shifts_update ON recurring_shifts;
CREATE POLICY recurring_shifts_update ON recurring_shifts FOR UPDATE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS recurring_shifts_delete ON recurring_shifts;
CREATE POLICY recurring_shifts_delete ON recurring_shifts FOR DELETE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

-- OPEN_SHIFTS table RLS
DROP POLICY IF EXISTS open_shifts_select ON open_shifts;
CREATE POLICY open_shifts_select ON open_shifts FOR SELECT
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS open_shifts_insert ON open_shifts;
CREATE POLICY open_shifts_insert ON open_shifts FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS open_shifts_update ON open_shifts;
CREATE POLICY open_shifts_update ON open_shifts FOR UPDATE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS open_shifts_delete ON open_shifts;
CREATE POLICY open_shifts_delete ON open_shifts FOR DELETE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

-- SHIFT_SWAPS table RLS
DROP POLICY IF EXISTS shift_swaps_select ON shift_swaps;
CREATE POLICY shift_swaps_select ON shift_swaps FOR SELECT
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS shift_swaps_insert ON shift_swaps;
CREATE POLICY shift_swaps_insert ON shift_swaps FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS shift_swaps_update ON shift_swaps;
CREATE POLICY shift_swaps_update ON shift_swaps FOR UPDATE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS shift_swaps_delete ON shift_swaps;
CREATE POLICY shift_swaps_delete ON shift_swaps FOR DELETE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

-- TIME_OFF_REQUESTS table RLS
DROP POLICY IF EXISTS time_off_requests_select ON time_off_requests;
CREATE POLICY time_off_requests_select ON time_off_requests FOR SELECT
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS time_off_requests_insert ON time_off_requests;
CREATE POLICY time_off_requests_insert ON time_off_requests FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS time_off_requests_update ON time_off_requests;
CREATE POLICY time_off_requests_update ON time_off_requests FOR UPDATE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS time_off_requests_delete ON time_off_requests;
CREATE POLICY time_off_requests_delete ON time_off_requests FOR DELETE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

-- ATTENDANCE_RECORDS table RLS
DROP POLICY IF EXISTS attendance_records_select ON attendance_records;
CREATE POLICY attendance_records_select ON attendance_records FOR SELECT
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS attendance_records_insert ON attendance_records;
CREATE POLICY attendance_records_insert ON attendance_records FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS attendance_records_update ON attendance_records;
CREATE POLICY attendance_records_update ON attendance_records FOR UPDATE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS attendance_records_delete ON attendance_records;
CREATE POLICY attendance_records_delete ON attendance_records FOR DELETE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

-- MAINTENANCE_TICKETS table RLS
DROP POLICY IF EXISTS maintenance_tickets_select ON maintenance_tickets;
CREATE POLICY maintenance_tickets_select ON maintenance_tickets FOR SELECT
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS maintenance_tickets_insert ON maintenance_tickets;
CREATE POLICY maintenance_tickets_insert ON maintenance_tickets FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS maintenance_tickets_update ON maintenance_tickets;
CREATE POLICY maintenance_tickets_update ON maintenance_tickets FOR UPDATE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS maintenance_tickets_delete ON maintenance_tickets;
CREATE POLICY maintenance_tickets_delete ON maintenance_tickets FOR DELETE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

-- ANNOUNCEMENTS table RLS
DROP POLICY IF EXISTS announcements_select ON announcements;
CREATE POLICY announcements_select ON announcements FOR SELECT
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS announcements_insert ON announcements;
CREATE POLICY announcements_insert ON announcements FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS announcements_update ON announcements;
CREATE POLICY announcements_update ON announcements FOR UPDATE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS announcements_delete ON announcements;
CREATE POLICY announcements_delete ON announcements FOR DELETE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

-- ANNOUNCEMENT_ACKNOWLEDGMENTS table RLS
DROP POLICY IF EXISTS announcement_acknowledgments_select ON announcement_acknowledgments;
CREATE POLICY announcement_acknowledgments_select ON announcement_acknowledgments FOR SELECT
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS announcement_acknowledgments_insert ON announcement_acknowledgments;
CREATE POLICY announcement_acknowledgments_insert ON announcement_acknowledgments FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS announcement_acknowledgments_update ON announcement_acknowledgments;
CREATE POLICY announcement_acknowledgments_update ON announcement_acknowledgments FOR UPDATE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user())
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

-- INCIDENT_REPORTS table RLS
DROP POLICY IF EXISTS incident_reports_select ON incident_reports;
CREATE POLICY incident_reports_select ON incident_reports FOR SELECT
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS incident_reports_insert ON incident_reports;
CREATE POLICY incident_reports_insert ON incident_reports FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS incident_reports_update ON incident_reports;
CREATE POLICY incident_reports_update ON incident_reports FOR UPDATE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS incident_reports_delete ON incident_reports;
CREATE POLICY incident_reports_delete ON incident_reports FOR DELETE
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

-- NOTIFICATIONS table RLS (user can see their own notifications)
DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (
    company_id = (SELECT private.current_user_company_id()) AND 
    private.is_active_user() AND
    (recipient_id = auth.uid() OR private.is_super_admin())
  );

DROP POLICY IF EXISTS notifications_insert ON notifications;
CREATE POLICY notifications_insert ON notifications FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user() AND private.can_manage_company(company_id));

DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (
    company_id = (SELECT private.current_user_company_id()) AND 
    private.is_active_user() AND
    (recipient_id = auth.uid() OR private.can_manage_company(company_id))
  )
  WITH CHECK (
    company_id = (SELECT private.current_user_company_id()) AND 
    private.is_active_user() AND
    (recipient_id = auth.uid() OR private.can_manage_company(company_id))
  );

-- ACTIVITY_TIMELINE table RLS
DROP POLICY IF EXISTS activity_timeline_select ON activity_timeline;
CREATE POLICY activity_timeline_select ON activity_timeline FOR SELECT
  USING (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

DROP POLICY IF EXISTS activity_timeline_insert ON activity_timeline;
CREATE POLICY activity_timeline_insert ON activity_timeline FOR INSERT
  WITH CHECK (company_id = (SELECT private.current_user_company_id()) AND private.is_active_user());

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_roles_company ON roles(company_id);
CREATE INDEX IF NOT EXISTS idx_shift_templates_company ON shift_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_shift_templates_department ON shift_templates(department_id);
CREATE INDEX IF NOT EXISTS idx_shifts_company ON shifts(company_id);
CREATE INDEX IF NOT EXISTS idx_shifts_employee ON shifts(employee_id);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(shift_date);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_weekly_schedules_company ON weekly_schedules(company_id);
CREATE INDEX IF NOT EXISTS idx_weekly_schedules_employee ON weekly_schedules(employee_id);
CREATE INDEX IF NOT EXISTS idx_weekly_schedules_week ON weekly_schedules(week_start_date);
CREATE INDEX IF NOT EXISTS idx_recurring_shifts_company ON recurring_shifts(company_id);
CREATE INDEX IF NOT EXISTS idx_recurring_shifts_employee ON recurring_shifts(employee_id);
CREATE INDEX IF NOT EXISTS idx_recurring_shifts_date_range ON recurring_shifts(company_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_open_shifts_company ON open_shifts(company_id);
CREATE INDEX IF NOT EXISTS idx_open_shifts_date ON open_shifts(shift_date);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_company ON shift_swaps(company_id);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_requestor ON shift_swaps(requestor_id);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_target ON shift_swaps(target_employee_id);
CREATE INDEX IF NOT EXISTS idx_time_off_requests_company ON time_off_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_time_off_requests_employee ON time_off_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_off_requests_dates ON time_off_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_company ON attendance_records(company_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_employee ON attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_date ON attendance_records(shift_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_company ON maintenance_tickets(company_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_assigned ON maintenance_tickets(assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_status ON maintenance_tickets(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_due ON maintenance_tickets(due_date);
CREATE INDEX IF NOT EXISTS idx_announcements_company ON announcements(company_id);
CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(published_at);
CREATE INDEX IF NOT EXISTS idx_announcement_acknowledgments_company ON announcement_acknowledgments(company_id);
CREATE INDEX IF NOT EXISTS idx_announcement_acknowledgments_announcement ON announcement_acknowledgments(announcement_id);
CREATE INDEX IF NOT EXISTS idx_incident_reports_company ON incident_reports(company_id);
CREATE INDEX IF NOT EXISTS idx_incident_reports_time ON incident_reports(incident_time);
CREATE INDEX IF NOT EXISTS idx_incident_reports_severity ON incident_reports(severity);
CREATE INDEX IF NOT EXISTS idx_notifications_company ON notifications(company_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_activity_timeline_company ON activity_timeline(company_id);
CREATE INDEX IF NOT EXISTS idx_activity_timeline_entity ON activity_timeline(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_timeline_created ON activity_timeline(created_at);
