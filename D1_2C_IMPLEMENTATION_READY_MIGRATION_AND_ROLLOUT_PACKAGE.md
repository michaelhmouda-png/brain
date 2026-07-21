# D1.2C Implementation-Ready Migration and Rollout Package

## 1. Status and authority

**Review package only. Nothing in this document has been executed.**

This package translates the authoritative D1.2A live audit and approved D1.2B design into small, forward-only migration units. It does not add SQL to the active `supabase/migrations` directory because several mappings and capability decisions still require human approval. After those gates are approved, the reviewed sections are to be copied into the exact filenames below without changing older migrations.

It does not authorize database execution, backfills, application changes, D1.3, K9, or any change to K8 `create_task`.

Authoritative facts:

- `supabase_migrations.schema_migrations` is absent (`42P01`); the live catalog is authoritative.
- `companies` has unconditional `anon` policies named `Temporary public read companies`, `Temporary public insert companies`, `Temporary public update companies`, and `Temporary public delete companies`.
- `employees` holds salary, phone, email, and notes in a broadly tenant-readable row.
- `employees.status` contains `active` and `actie`; `employment_type` contains `full-time` and `full time`.
- Audited profiles were unlinked; `profiles.employee_id` is nonunique.
- Current aggregates have no detected tenant mismatch, but structural protection is absent.
- Employee deletion cascades into workforce history.
- K8 task creation is canonical and working.

## 2. Package rules

Every migration must be transactional, fail before mutation when preconditions differ, touch one responsibility, preserve legacy evidence until contraction, qualify schemas, and have a safe recovery path. New trusted RPCs use forced RLS, least privilege, `SECURITY DEFINER`, and an explicit `search_path`. Unknown values are never coerced. Existing migrations are never rewritten.

“Rollback” means safe stage recovery. It never means restoring anonymous access, destructive cascades, or deleting preserved data.

## 3. Exact migration order

The repository sequence currently ends at `202607210009_notification_foundation_n1.sql`. Subject to baseline approval H1, reserve:

| Order | Exact filename | Responsibility | Dependency |
|---:|---|---|---|
| 1 | `202607210010_d1_security_close_anonymous_company_crud.sql` | Remove anonymous company CRUD | none |
| 2 | `202607210011_d1_employee_catalog_baseline.sql` | Catalog fingerprint/checkpoint | 010, H1 |
| 3 | `202607210012_d1_employee_foundation_expand.sql` | Lifecycle foundation and mapping exceptions | 011, H2 |
| 4 | `202607210013_d1_employee_sensitive_data_expand.sql` | Private details, compensation, notes | 012, H3 |
| 5 | `202607210014_d1_employment_positions_assignments_expand.sql` | Relationships, positions, assignments | 012, H4 |
| 6 | `202607210015_d1_profile_employee_link_constraints.sql` | Optional unique same-tenant link | 012, H5 |
| 7 | `202607210016_d1_workforce_tenant_integrity_constraints.sql` | Composite tenant FKs, including task assignee | 014/015, H6 |
| 8 | `202607210017_d1_employee_history_preservation.sql` | Replace history cascades; prohibit direct delete | 016, H7 |
| 9 | `202607210018_d1_employee_command_transactional_outbox.sql` | Focused employee command receipt/outbox/RPC | 012/013/015/017, H8 |
| reserved | `202607210019_d1_employee_legacy_contract.sql` | Later legacy contraction | separate approval |

Migration 019 is not part of executable D1.2C. No legacy column is dropped by 010–018.

```text
010 security -> 011 baseline -> 012 foundation
                                  |-> 013 sensitive
                                  |-> 014 organization --|
                                  |-> 015 profile link ---|-> 016 tenant integrity
                                                              -> 017 history
                                                                  -> 018 command/outbox
K8 create_task -------------------------------------------------------- unchanged
```

## 4. Global preflight

Archive sanitized results immediately before each deployment:

```sql
SELECT current_database() AS database_name,
       current_setting('server_version') AS server_version,
       current_user AS deployment_role;

SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE (n.nspname, c.relname) IN (
 ('public','companies'),('public','profiles'),('public','employees'),
 ('public','locations'),('public','departments'),('public','tasks'),
 ('public','attendance_records'),('public','shifts'),('public','weekly_schedules'),
 ('public','recurring_shifts'),('public','shift_swaps'),('public','time_off_requests'),
 ('public','announcement_acknowledgments'),('public','brain_action_proposals'),
 ('public','brain_domain_events'),('public','brain_event_outbox'))
ORDER BY 1,2;

SELECT 'employees' AS relation_name,count(*) AS row_count FROM public.employees
UNION ALL SELECT 'profiles',count(*) FROM public.profiles
UNION ALL SELECT 'tasks',count(*) FROM public.tasks
UNION ALL SELECT 'attendance_records',count(*) FROM public.attendance_records
UNION ALL SELECT 'shifts',count(*) FROM public.shifts
UNION ALL SELECT 'weekly_schedules',count(*) FROM public.weekly_schedules
UNION ALL SELECT 'recurring_shifts',count(*) FROM public.recurring_shifts
UNION ALL SELECT 'shift_swaps',count(*) FROM public.shift_swaps
UNION ALL SELECT 'time_off_requests',count(*) FROM public.time_off_requests
UNION ALL SELECT 'announcement_acknowledgments',count(*) FROM public.announcement_acknowledgments;

SELECT status,count(*) FROM public.employees GROUP BY status ORDER BY status;
SELECT employment_type,count(*) FROM public.employees GROUP BY employment_type ORDER BY employment_type;

SELECT count(*) AS duplicate_employee_links FROM (
 SELECT employee_id FROM public.profiles WHERE employee_id IS NOT NULL
 GROUP BY employee_id HAVING count(*) > 1) AS d;

SELECT count(*) AS profile_employee_tenant_mismatches
FROM public.profiles AS p JOIN public.employees AS e ON e.id=p.employee_id
WHERE p.company_id IS DISTINCT FROM e.company_id;

SELECT p.oid::regprocedure::text AS signature,
       pg_catalog.pg_get_function_result(p.oid) AS result_type,
       p.prosecdef AS security_definer,p.proconfig AS function_config
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='create_task_with_outbox_event';
```

Stop for any missing object, unexpected count, mismatch, duplicate link, or changed K8 fingerprint.

## 5. Migration 010 — urgent anonymous company closure

This is independently deployable. It preserves authenticated policies and removes only the four confirmed temporary policies and `anon` table privileges.

### Preflight

```sql
SELECT pol.polname,pol.polcmd,pol.polroles::regrole[] AS roles,
 pg_catalog.pg_get_expr(pol.polqual,pol.polrelid) AS using_expression,
 pg_catalog.pg_get_expr(pol.polwithcheck,pol.polrelid) AS check_expression
FROM pg_catalog.pg_policy AS pol
WHERE pol.polrelid='public.companies'::regclass ORDER BY pol.polname;

SELECT grantee,privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='companies'
ORDER BY grantee,privilege_type;
```

Required: the four exact temporary policies and reviewed authenticated `companies_select`, `companies_insert`, `companies_update`, and `companies_delete` policies exist; provisioning is proven not to depend on anonymous direct writes.

### Implementation-ready SQL

```sql
BEGIN;
DO $guard$
DECLARE v_missing integer;
BEGIN
 SELECT count(*) INTO v_missing
 FROM (VALUES
  ('Temporary public read companies'),('Temporary public insert companies'),
  ('Temporary public update companies'),('Temporary public delete companies')) AS x(policy_name)
 WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_policy AS p
  WHERE p.polrelid='public.companies'::regclass AND p.polname=x.policy_name);
 IF v_missing<>0 THEN
  RAISE EXCEPTION 'D1_COMPANY_POLICY_PREFLIGHT_FAILED: % missing',v_missing;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS p
   WHERE p.polrelid='public.companies'::regclass AND p.polname='companies_select') THEN
  RAISE EXCEPTION 'D1_COMPANY_AUTHENTICATED_SELECT_POLICY_MISSING';
 END IF;
END
$guard$;

DROP POLICY "Temporary public read companies" ON public.companies;
DROP POLICY "Temporary public insert companies" ON public.companies;
DROP POLICY "Temporary public update companies" ON public.companies;
DROP POLICY "Temporary public delete companies" ON public.companies;
REVOKE ALL PRIVILEGES ON TABLE public.companies FROM anon;
COMMIT;
```

### Validation and recovery

```sql
SELECT count(*) AS temporary_anon_policy_count
FROM pg_catalog.pg_policy AS p
WHERE p.polrelid='public.companies'::regclass
AND p.polname IN ('Temporary public read companies','Temporary public insert companies',
 'Temporary public update companies','Temporary public delete companies');

SELECT count(*) AS anon_company_privilege_count
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='companies' AND grantee='anon';
```

Both must be zero. In an isolated test project, anonymous select/insert/update/delete must be denied; active authenticated and privileged behavior must remain as intended.

Production rollback must not restore unconditional anonymous CRUD. Keep 010, identify the legitimate authenticated operation, and deploy a separately reviewed focused authenticated/server boundary. Recreating `TO anon USING (true)` or `WITH CHECK (true)` is prohibited outside a disposable security regression fixture.

If deployment tooling accidentally removed the legitimate authenticated table grant, the only pre-approved recovery SQL is the narrow restoration below. It does not change policies or reopen anonymous access; the existing authenticated RLS policies still decide rows and operations:

```sql
BEGIN;
REVOKE ALL PRIVILEGES ON TABLE public.companies FROM anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.companies TO authenticated;
COMMIT;
```

Run it only after the policy preflight confirms the reviewed `companies_*` policies are intact. If they are not intact, stop and prepare a separately reviewed corrective migration from the captured definitions.

## 6. Migration 011 — catalog baseline

Because standard migration history is absent, create server-only deployment evidence without claiming older SQL was applied:

```sql
BEGIN;
CREATE TABLE public.d1_employee_migration_checkpoints (
 migration_name text PRIMARY KEY,
 baseline_version integer NOT NULL CHECK (baseline_version=1),
 catalog_fingerprint text NOT NULL CHECK (catalog_fingerprint~'^[0-9a-f]{64}$'),
 aggregate_counts jsonb NOT NULL CHECK (jsonb_typeof(aggregate_counts)='object'),
 approval_reference text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.d1_employee_migration_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d1_employee_migration_checkpoints FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.d1_employee_migration_checkpoints FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.d1_employee_migration_checkpoints TO service_role;
COMMIT;
```

H1 approves fingerprint generation, approval-reference format, and sequence start. Recovery leaves append-only evidence unused; recorded fingerprints are never rewritten.

## 7. Migration 012 — employee foundation and vocabulary

```sql
BEGIN;
ALTER TABLE public.employees
 ADD COLUMN employee_number text,
 ADD COLUMN lifecycle_status text,
 ADD COLUMN version bigint NOT NULL DEFAULT 1,
 ADD COLUMN lifecycle_effective_at timestamptz,
 ADD COLUMN archived_at timestamptz,
 ADD COLUMN archived_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
 ADD COLUMN termination_reason_code text;

ALTER TABLE public.employees
 ADD CONSTRAINT employees_lifecycle_status_check CHECK (
  lifecycle_status IS NULL OR lifecycle_status IN
  ('draft','active','on_leave','inactive','terminated','archived')) NOT VALID,
 ADD CONSTRAINT employees_version_positive CHECK (version>0) NOT VALID,
 ADD CONSTRAINT employees_archive_shape CHECK (
  (lifecycle_status='archived' AND archived_at IS NOT NULL)
  OR lifecycle_status IS DISTINCT FROM 'archived') NOT VALID;

CREATE UNIQUE INDEX employees_company_id_id_uidx ON public.employees(company_id,id);
CREATE UNIQUE INDEX employees_company_employee_number_uidx
 ON public.employees(company_id,employee_number) WHERE employee_number IS NOT NULL;

CREATE TABLE public.employee_migration_exceptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL,
 field_name text NOT NULL CHECK (field_name IN ('status','employment_type','role','department')),
 source_value_hash text NOT NULL CHECK (source_value_hash~'^[0-9a-f]{64}$'),
 resolution_status text NOT NULL DEFAULT 'pending'
  CHECK (resolution_status IN ('pending','approved','rejected')),
 approved_canonical_value text,
 reviewed_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
 reviewed_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(employee_id,field_name),
 FOREIGN KEY(company_id,employee_id) REFERENCES public.employees(company_id,id)
  ON DELETE RESTRICT);
ALTER TABLE public.employee_migration_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_migration_exceptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_migration_exceptions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.employee_migration_exceptions TO service_role;

UPDATE public.employees AS e SET lifecycle_status='active',
 lifecycle_effective_at=COALESCE(e.updated_at,e.created_at)
WHERE e.status='active' AND e.lifecycle_status IS NULL;

INSERT INTO public.employee_migration_exceptions
 (employee_id,company_id,field_name,source_value_hash)
SELECT e.id,e.company_id,'status',encode(digest(e.status,'sha256'),'hex')
FROM public.employees AS e WHERE e.status<>'active'
ON CONFLICT (employee_id,field_name) DO NOTHING;

ALTER TABLE public.employees VALIDATE CONSTRAINT employees_lifecycle_status_check;
ALTER TABLE public.employees VALIDATE CONSTRAINT employees_version_positive;
ALTER TABLE public.employees VALIDATE CONSTRAINT employees_archive_shape;
COMMIT;
```

Preflight must confirm `digest` already exists; adding an extension requires separate approval. `actie` remains unchanged and canonical status remains null until H2. Legacy `status` remains for compatibility. Canonical employment types are `full_time`, `part_time`, `casual`, `seasonal`, `contractor`, `intern`; only approved `full-time`/`full time` mappings become `full_time` in migration 014. Unknowns create exceptions. Recovery leaves new columns unused and preserves legacy evidence.

## 8. Migration 013 — sensitive-data separation

```sql
BEGIN;
CREATE TABLE public.employee_private_details (
 employee_id uuid PRIMARY KEY,company_id uuid NOT NULL,phone text,email text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,employee_id),
 FOREIGN KEY(company_id,employee_id) REFERENCES public.employees(company_id,id)
  ON DELETE RESTRICT);

CREATE TABLE public.employee_compensation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,
 employee_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>=0),
 currency_code text NOT NULL CHECK(currency_code~'^[A-Z]{3}$'),
 compensation_type text NOT NULL DEFAULT 'salary'
  CHECK(compensation_type IN ('salary','hourly')),
 effective_from date NOT NULL,effective_to date,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
 CHECK(effective_to IS NULL OR effective_to>=effective_from),
 FOREIGN KEY(company_id,employee_id) REFERENCES public.employees(company_id,id)
  ON DELETE RESTRICT);
CREATE UNIQUE INDEX employee_compensation_one_current_uidx
 ON public.employee_compensation(company_id,employee_id) WHERE effective_to IS NULL;

CREATE TABLE public.employee_confidential_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,
 employee_id uuid NOT NULL,category text NOT NULL,
 note_text text NOT NULL CHECK(btrim(note_text)<>''),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,employee_id) REFERENCES public.employees(company_id,id)
  ON DELETE RESTRICT);

ALTER TABLE public.employee_private_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_private_details FORCE ROW LEVEL SECURITY;
ALTER TABLE public.employee_compensation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_compensation FORCE ROW LEVEL SECURITY;
ALTER TABLE public.employee_confidential_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_confidential_notes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_private_details,public.employee_compensation,
 public.employee_confidential_notes FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.employee_private_details,
 public.employee_compensation,public.employee_confidential_notes TO service_role;

INSERT INTO public.employee_private_details(employee_id,company_id,phone,email)
SELECT e.id,e.company_id,e.phone,e.email FROM public.employees AS e;
-- Salary waits for approved currency/effective date. Notes wait for category/creator.
COMMIT;
```

### Proposed exact access rules (approval H3)

Storage stays `service_role`-only. Focused server boundaries derive active profile, persisted company, and linked employee; no browser gets direct table access.

| Data | Employee | Manager | Owner | Super admin |
|---|---|---|---|---|
| Safe directory | persisted company | persisted company | persisted company | explicit persisted tenant context |
| Own private contact | self | self | self | self |
| Other private contact | denied | denied pending HR capability | same company | same authorized company, audited reason |
| Compensation | denied | denied pending capability | same company | same authorized company, audited reason |
| Confidential notes | denied | denied pending capability | same company | same authorized company, audited reason |
| Sensitive writes | approved self fields only | capability only | focused command | focused command |

Authorization comes only from `profiles.role`/approved capabilities, never employee role, position, name, or contact values.

Backfill contact values, compare count/null counts and server-side values, and preserve original legacy fields. Salary and notes do not move until required metadata is approved. Application readers must later switch to safe projections/focused endpoints. Broad base-table `SELECT` and legacy sensitive columns change only in separately approved migration 019. Therefore 013 preserves data but does not alone close the original broad-read exposure.

Validation:

```sql
SELECT (SELECT count(*) FROM public.employees) AS employees,
 (SELECT count(*) FROM public.employee_private_details) AS private_rows;
SELECT count(*) AS contact_mismatches
FROM public.employees AS e JOIN public.employee_private_details AS d
 ON (d.company_id,d.employee_id)=(e.company_id,e.id)
WHERE d.phone IS DISTINCT FROM e.phone OR d.email IS DISTINCT FROM e.email;
SELECT table_name,grantee,privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name IN
 ('employee_private_details','employee_compensation','employee_confidential_notes')
ORDER BY 1,2,3;
```

Recovery retains the restricted copies and leaves legacy readers unchanged.

## 9. Migration 014 — employment and organization

Create tenant-owned `employment_relationships`, `positions`, and `employee_position_assignments`, all forced-RLS and server-only until application services exist. All employee/organization references use composite tenant keys; effective intervals must be valid; a partial unique index enforces one current primary assignment.

```sql
CREATE UNIQUE INDEX locations_company_id_id_uidx ON public.locations(company_id,id);
CREATE UNIQUE INDEX departments_company_id_id_uidx ON public.departments(company_id,id);

CREATE TABLE public.employment_relationships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,
 employee_id uuid NOT NULL,employment_type text NOT NULL CHECK(employment_type IN
  ('full_time','part_time','casual','seasonal','contractor','intern')),
 relationship_status text NOT NULL CHECK(relationship_status IN ('active','ended')),
 start_date date NOT NULL,end_date date,probation_end_date date,
 termination_reason_code text,
 created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(end_date IS NULL OR end_date>=start_date),
 FOREIGN KEY(company_id,employee_id) REFERENCES public.employees(company_id,id)
  ON DELETE RESTRICT);
CREATE UNIQUE INDEX employment_relationships_one_current_uidx
 ON public.employment_relationships(company_id,employee_id) WHERE end_date IS NULL;

CREATE TABLE public.positions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,
 code text NOT NULL,title text NOT NULL,description text,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,id),UNIQUE(company_id,code),
 FOREIGN KEY(company_id) REFERENCES public.companies(id) ON DELETE RESTRICT);

CREATE TABLE public.employee_position_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,
 employee_id uuid NOT NULL,position_id uuid NOT NULL,
 location_id uuid,department_id uuid,reporting_employee_id uuid,
 is_primary boolean NOT NULL DEFAULT false,
 effective_from date NOT NULL,effective_to date,
 created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(effective_to IS NULL OR effective_to>=effective_from),
 UNIQUE(company_id,id),
 FOREIGN KEY(company_id,employee_id) REFERENCES public.employees(company_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(company_id,position_id) REFERENCES public.positions(company_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(company_id,location_id) REFERENCES public.locations(company_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(company_id,department_id) REFERENCES public.departments(company_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(company_id,reporting_employee_id) REFERENCES public.employees(company_id,id)
  ON DELETE RESTRICT);
CREATE UNIQUE INDEX employee_position_one_current_primary_uidx
 ON public.employee_position_assignments(company_id,employee_id)
 WHERE is_primary AND effective_to IS NULL;

ALTER TABLE public.employment_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employment_relationships FORCE ROW LEVEL SECURITY;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.employee_position_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_position_assignments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.employment_relationships,public.positions,
 public.employee_position_assignments FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.employment_relationships,public.positions,
 public.employee_position_assignments TO service_role;
```

Legacy `employees.role` and `employees.department` are never inferred into positions/assignments. `hire_date` seeds `start_date` only when approved; missing values create exceptions. Recovery leaves new structures unused and legacy fields intact.

## 10. Migration 015 — profile/employee links

No row backfill is included. Every initial link is human-reviewed.

```sql
BEGIN;
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.profiles p
  WHERE p.employee_id IS NOT NULL AND p.company_id IS NULL) THEN
  RAISE EXCEPTION 'PROFILE_EMPLOYEE_LINK_WITHOUT_COMPANY'; END IF;
 IF EXISTS(SELECT 1 FROM public.profiles p JOIN public.employees e ON e.id=p.employee_id
  WHERE p.company_id IS DISTINCT FROM e.company_id) THEN
  RAISE EXCEPTION 'PROFILE_EMPLOYEE_TENANT_MISMATCH'; END IF;
 IF EXISTS(SELECT 1 FROM public.profiles WHERE employee_id IS NOT NULL
  GROUP BY employee_id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'DUPLICATE_PROFILE_EMPLOYEE_LINK'; END IF;
END $guard$;
CREATE UNIQUE INDEX profiles_employee_id_unique_when_linked
 ON public.profiles(employee_id) WHERE employee_id IS NOT NULL;
ALTER TABLE public.profiles
 ADD CONSTRAINT profiles_employee_requires_company
  CHECK(employee_id IS NULL OR company_id IS NOT NULL) NOT VALID,
 ADD CONSTRAINT profiles_company_employee_fk
  FOREIGN KEY(company_id,employee_id) REFERENCES public.employees(company_id,id)
  ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_employee_requires_company;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_company_employee_fk;
COMMIT;
```

Link/unlink commands lock both records, derive actor/profile/tenant, validate same company, and emit safe events. They never search by name, email, or phone. Recovery uses audited unlink, not row deletion.

## 11. Migration 016 — structural tenant enforcement

Add unique `(company_id,id)` keys to tenant parents before `NOT VALID` composite FKs. Validate each after zero-orphan/zero-mismatch preflight.

| Child | Columns | Parent |
|---|---|---|
| employees | `(company_id, location_id)` | locations `(company_id, id)` |
| employees | `(company_id, department_id)` | departments `(company_id, id)` |
| departments | `(company_id, location_id)` | locations `(company_id, id)` |
| departments | `(company_id, manager_employee_id)` | employees `(company_id, id)` |
| shifts | `(company_id, employee_id)` | employees `(company_id, id)` |
| shifts | `(company_id, department_id)` | departments `(company_id, id)` |
| attendance_records | `(company_id, employee_id)` | employees `(company_id, id)` |
| time_off_requests | `(company_id, employee_id)` | employees `(company_id, id)` |
| shift_swaps | `(company_id, requestor_id)` | employees `(company_id, id)` |
| shift_swaps | `(company_id, target_employee_id)` | employees `(company_id, id)` |
| weekly_schedules | `(company_id, employee_id)` | employees `(company_id, id)` |
| recurring_shifts | `(company_id, employee_id)` | employees `(company_id, id)` |
| open_shifts | `(company_id, filled_by_employee_id)` | employees `(company_id, id)` |
| tasks | `(company_id, assigned_employee_id)` | employees `(company_id, id)` |

Nullable child IDs remain permitted; non-null IDs must share the company. Preserve live `requestor_id` spelling.

```sql
ALTER TABLE public.tasks ADD CONSTRAINT tasks_company_assigned_employee_fk
 FOREIGN KEY(company_id,assigned_employee_id)
 REFERENCES public.employees(company_id,id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.tasks VALIDATE CONSTRAINT tasks_company_assigned_employee_fk;
```

The task FK is structural only. It cannot alter the K8 RPC name/signature/result/grants, proposal validation, idempotency, event, or outbox. Each child uses the same pattern. If lock risk requires splitting, use release-approved ordered suffixes `016a`–`016n`. Recovery drops only a newly added unvalidated constraint; production rows are never automatically changed.

## 12. Migration 017 — history preservation

Replace employee-directed `ON DELETE CASCADE` with `ON DELETE RESTRICT` for:

- `announcement_acknowledgments.employee_id`
- `attendance_records.employee_id`
- `recurring_shifts.employee_id`
- `shift_swaps.requestor_id` and `target_employee_id`
- `shifts.employee_id`
- `time_off_requests.employee_id`
- `weekly_schedules.employee_id`

Keep reviewed operational pointers `SET NULL`: `departments.manager_employee_id`, `maintenance_tickets.assigned_to_id`, and `open_shifts.filled_by_employee_id`. Profiles and tasks use restrictive protection from 015/016. No history row is changed.

Capture exact live names first:

```sql
SELECT con.conname,con.conrelid::regclass::text AS child_table,
 pg_catalog.pg_get_constraintdef(con.oid,true) AS definition
FROM pg_catalog.pg_constraint AS con
WHERE con.contype='f' AND con.confrelid='public.employees'::regclass
ORDER BY 2,1;
```

Embed the reviewed names and fail if definitions differ:

```sql
ALTER TABLE public.attendance_records
 DROP CONSTRAINT <captured_exact_constraint_name>,
 ADD CONSTRAINT <captured_exact_constraint_name>
 FOREIGN KEY(employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;
```

The angle-bracket token is a mandatory build-time substitution from the catalog attachment; migration 017 is not releasable while any token remains. Drop only `employees_delete`; do not create a direct-delete policy. Revoke authenticated `DELETE` on `employees`. Lifecycle commands replace deletion after application routing approval.

Validation:

```sql
SELECT con.conrelid::regclass::text AS child_table,con.conname,con.confdeltype,
 pg_catalog.pg_get_constraintdef(con.oid,true) AS definition
FROM pg_catalog.pg_constraint AS con
WHERE con.contype='f' AND con.confrelid='public.employees'::regclass
ORDER BY 1,2;
```

No historical relation may have `confdeltype='c'`; before/after child counts must match. Never test by deleting an employee. Recovery retains restrictive behavior and uses forward application correction.

## 13. Migration 018 — focused K1–K8 employee persistence

This migration provides persistence primitives only; application routing is a later approved code stage. It is not a generic command bus.

Create:

- `employee_command_receipts`: forced-RLS server-only idempotency and safe deterministic result.
- `employee_event_outbox`: forced-RLS server-only employee obligations, separate because K8 `brain_event_outbox` is deliberately constrained to `task.created`.
- exactly one focused RPC for the first H8-approved employee command/version.

Receipt contract:

```text
command_id uuid primary key
company_id uuid
actor_id uuid
profile_id uuid
command_type text
command_version integer
idempotency_key char(64)
payload_hash char(64)
correlation_id uuid
causation_id uuid
aggregate_id uuid
result_summary jsonb (safe: no contact, compensation, or notes)
created_at timestamptz (database time)
unique(company_id, idempotency_key)
unique(company_id, command_id)
```

The outbox mirrors K8 authority metadata but permits only the implemented `employee.*` type/version and excludes sensitive payloads.

One transaction must: validate active persisted actor/profile/tenant; validate executing proposal for AI; authorize using canonical profile authority; validate payload/transition; claim idempotency or return identical safe result; reject conflicting reuse; lock aggregate and check version; mutate; insert outbox; persist result. Any failure commits nothing. Delivery failure leaves pending outbox and never reruns mutation; identical delivery is idempotent and conflicting duplicates fail closed.

Browser/model input never selects actor, profile, tenant, role, event metadata, hash, or execution metadata. Tables revoke all from `PUBLIC`, `anon`, `authenticated`; only least-privilege `service_role` access remains. RPCs are `SECURITY DEFINER SET search_path=public,pg_temp`, schema-qualified, revoked from public/anon/authenticated, and executable only by `service_role`.

After separate application approval:

```text
human/API -> ActorContext -> TenantScope -> CommandEnvelope -> handler -> service -> RPC
AI -> Stage 0C proposal/confirmation -> K7 registry -> same handler/service -> same RPC
```

Legacy direct and Brain paths retire only after parity. Migration 018 alone does not route callers.

## 14. Validation and tests

### Database/RLS/tenant tests

1. Anonymous company CRUD denied; intended authenticated access retained.
2. New sensitive, receipt, and outbox tables have enabled and forced RLS.
3. `PUBLIC`, `anon`, and `authenticated` have no direct sensitive/receipt/outbox privileges.
4. Every definer function has safe `search_path` and exact grants.
5. Canonical structures accept only approved statuses/types; `actie` and unknowns remain blocked.
6. Contact backfill count/value comparison succeeds without exporting values; salary/notes wait for metadata.
7. Duplicate and cross-company profile links fail; null link and audited unlink preserve records.
8. Every composite relation rejects cross-company and accepts valid same-company references.
9. Authenticated direct employee delete is denied.
10. Employee mutation/outbox are atomic; identical retry returns identical safe result; conflicting idempotency fails closed.
11. Delivery failure stays pending and cannot repeat mutation.
12. Events cannot contain contact, compensation, notes, documents, or protected values.

Test unauthenticated, inactive, employee, manager, owner, and super_admin contexts. Persisted-company scope is mandatory; a client-supplied company never expands scope. Multi-company super-admin selection requires an explicit server-authorized tenant context.

### History and rollback tests

- Attendance, shift, weekly/recurring schedule, time-off, swap, acknowledgment, task, audit, proposal, domain-event, and outbox counts remain unchanged.
- Termination/archive preserves employee UUID and historical joins.
- Physical delete fails without changing child counts.
- Rehire follows H4 and never overwrites old history.
- Inject each preflight violation in an isolated clone and prove transaction rollback leaves schema/data unchanged.
- Disable new read routing during compatibility and prove legacy reads still work before contraction.
- No rollback deletes employee, private, receipt, outbox, or event data.

### Existing behavior

- K1–K8 focused tests and Stage 0A–0C tests.
- Exact K8 RPC signature/result/grants and `task.created` envelope comparison.
- K8 Supabase-backed task/outbox atomicity and live smoke test.
- Stage 0C proposal lifecycle tests.
- Tasks page/Brain task tenant and assignee visibility.
- Employee read compatibility, auth/provisioning, locations, departments, shifts, attendance, time off, and swaps.

Any K8 signature, proposal, result, event, outbox, or idempotency drift blocks release.

## 15. Deployment checkpoints

1. **Approval/backup:** approve H1; confirm PITR; archive catalog/count/function fingerprints; prove provisioning does not use anon company writes.
2. **Security:** apply only 010; validate catalog and isolated anonymous/authenticated runtime behavior; observe provisioning.
3. **Baseline/foundation:** apply 011/012 after H1/H2; keep `actie` unresolved unless reviewed; regress K8 and legacy reads.
4. **Private expand:** apply 013 after H3 and metadata decisions; compare internally; do not claim privacy closure before read cutover/019.
5. **Relationships/links:** apply 014/015 after mapping/link approval; links are separately logged trusted commands, never guessed SQL.
6. **Tenant/history:** apply 016 in bounded groups; apply 017 after hard-delete callers are release-gated; compare history counts.
7. **Command pilot:** apply 018 for one approved command; later route callers; test atomicity/idempotency/events; migrate Brain only after parity.
8. **Contract:** after proof and separate destructive approval, create/review 019. Not part of this package's execution authority.

## 16. Compatibility risks

| Risk | Control |
|---|---|
| Provisioning uses anon company writes | Trace before 010; add a focused authenticated boundary forward |
| UI selects wide employees row | Preserve legacy fields until read cutover |
| Brain Score reads status/contact/role | Preserve columns; migrate separately before contract |
| Wrong `actie` mapping | Nullable canonical status plus exception and human review |
| Missing salary currency/effective date | No compensation backfill until approved |
| Notes lack category/creator | No notes backfill until approved |
| Legacy roles become authorization/positions | Preserve only; never auto-map/authorize |
| Legacy department is required | Preserve until reviewed mapping/non-use proof |
| FK validation locks | Index first, `NOT VALID`, controlled validation windows |
| Empty tables hide defects | Structural and isolated cross-tenant tests |
| PII-based profile guessing | Operator-reviewed UUID links only |
| Sensitive copies diverge | One transactional canonical writer after cutover |
| Missing migration history causes collision | H1 catalog baseline and number reservation |
| K8 regression | No K8 edits; fingerprint/test every checkpoint |

## 17. Human approval gates

| Gate | Decision | Blocks |
|---|---|---|
| H1 | Catalog baseline method, fingerprint, approval reference, sequence start | 011 onward |
| H2 | Status/type vocabularies and exact disposition of `actie` | 012 completion |
| H3 | Privacy matrix; salary currency/effective date; note category/creator; self fields | 013 backfill/cutover |
| H4 | Legacy role mapping, department meaning, missing hire date, rehire policy | 014 |
| H5 | Exact profile/employee UUID pairs, operator, unlink workflow | link operations |
| H6 | Composite task-assignee FK while preserving K8 | task part of 016 |
| H7 | Universal normal hard-delete prohibition and retention | 017 |
| H8 | First canonical employee command and authorization/transition rules | 018 |
| H9 | Proof of no legacy readers/writers and destructive contract approval | reserved 019 |

No gate may be satisfied by inferred names, emails, phones, roles, or guessed data.

## 18. Stop conditions and completion boundary

Stop for catalog drift, mismatch/orphan/duplicate, unexpected vocabulary, required invented metadata, changed reference count, ordinary sensitive-table access, client-selected authority metadata, or any K8 contract drift.

This D1.2C package supplies exact filenames/order, dependencies, preflights, implementation SQL/skeletons, validation, recovery, checkpoints, compatibility risks, tests, and approval decisions. It does not add/apply migrations, access the live database, modify production data or application code, infer links/mappings, remove legacy fields, alter K1–K8/K8 `create_task`, or begin D1.3/K9.
