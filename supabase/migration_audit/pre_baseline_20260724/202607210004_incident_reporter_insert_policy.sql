-- Permit every active canonical application role to report an incident for
-- only its persisted company and authenticated profile. Existing SELECT,
-- UPDATE, and DELETE policies are intentionally untouched.

ALTER TABLE public.incident_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS incident_reports_insert ON public.incident_reports;
CREATE POLICY incident_reports_insert
  ON public.incident_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.incident_reports.status = 'open'
    AND public.incident_reports.reported_by_id = auth.uid()
    AND EXISTS (
      SELECT 1
        FROM public.profiles AS pr
       WHERE pr.id = auth.uid()
         AND pr.id = public.incident_reports.reported_by_id
         AND pr.status = 'active'
         AND pr.role IN ('employee', 'manager', 'owner', 'super_admin')
         AND pr.company_id = public.incident_reports.company_id
    )
    AND (
      public.incident_reports.location_id IS NULL
      OR EXISTS (
        SELECT 1
          FROM public.locations AS loc
         WHERE loc.id = public.incident_reports.location_id
           AND loc.company_id = public.incident_reports.company_id
      )
    )
  );

COMMENT ON POLICY incident_reports_insert ON public.incident_reports IS
  'Active canonical users may report only as themselves, for their persisted company, with an optional same-company location and initial open status.';
