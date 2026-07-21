# D1.2A Live Schema and Employee Data Audit

## 1. Status

**Complete for the approved D1.2A evidence scope.**

This is a read-only audit of the confirmed Brain development Supabase project. It combines:

- The 23-section consolidated live evidence export
- The separately recorded Query 9.2 result (`42P01`)
- The corrected live `shift_swaps.requestor_id` shape
- Repository SQL, TypeScript, API, UI, Brain, K1–K8, and Brain Score inspection

No database or application change was made. This report is evidence and recommendations only. D1.2B, D1.3, and K9 were not started.

## 2. Environment and read-only guarantee

| Item | Result | Confidence |
|---|---|---:|
| Project reference | `jjhtasppfxunbrswgxht` | High |
| Environment | Brain development; only current Brain development project | Owner-confirmed |
| Live schemas found | `auth`, `public` | High |
| `auth` owner | `supabase_admin` | High |
| `public` owner | `pg_database_owner` | High |
| Public table owner | Predominantly `postgres` | High |
| Migration-history relation | `supabase_migrations.schema_migrations` absent (`42P01`) | High |

Read-only guarantees were maintained:

- Evidence used only catalog `SELECT` statements and aggregate `SELECT` statements.
- No raw employee names, IDs, emails, phone numbers, salary amounts, notes, auth metadata values, or documents were exported.
- No RPC was invoked.
- No INSERT, UPDATE, DELETE, DDL, migration, backfill, seed, reset, or mutation smoke test occurred.
- Secrets were not requested, printed, or stored.

## 3. Live schema inventory

### Core tenant and identity

| Object | Confirmed live shape | Material observations |
|---|---|---|
| `auth.users` | Standard Supabase auth structure; 2 aggregate rows | No personal auth values inspected |
| `public.profiles` | `id`, nullable `company_id`, nullable `employee_id`, `full_name`, constrained auth `role`, constrained `status`, timestamps | No unique constraint on `employee_id`; tenant is nullable |
| `public.companies` | Identity, display/configuration fields, timestamps | Temporary anonymous CRUD policies are live |
| `public.locations` | Tenant, address/contact/configuration, status | No tenant-scoped name uniqueness or status checks |
| `public.departments` | Tenant, optional location, optional manager employee, name/status | No composite tenant constraints |
| `public.employees` | Tenant, optional location/department IDs, names, free-text role and department, phone/email, employment type, nullable salary, hire date, status, notes, timestamps | Wide PII/compensation row; only PK constraint/index |

The live Employee shape is:

```text
id uuid not null
company_id uuid not null
location_id uuid null
first_name text not null
last_name text not null
role text not null
department text not null
phone text null
email text null
employment_type text not null
salary numeric null
hire_date date null
status text not null
notes text null
created_at timestamptz not null
updated_at timestamptz not null
department_id uuid null
```

`employees` has no live check constraint for role, status, employment type, or salary; no tenant-scoped employee number; no lifecycle history; no aggregate version; no archive/termination metadata; and no uniqueness other than its primary key.

### Scheduling and workforce

Confirmed tables:

- `roles`
- `shift_templates`
- `shifts`
- `weekly_schedules`
- `recurring_shifts`
- `open_shifts`
- `shift_swaps`
- `time_off_requests`
- `attendance_records`

Not found by the workforce-object inventory:

- Generic `schedules` or normalized shift-assignment tables
- `clock_events`
- Separate `leave_requests`
- Employee skills
- Employee certifications
- Positions
- Employee availability
- Attendance corrections or evidence tables

The live shift-swap columns are `requestor_id` and `target_employee_id`. This matches [hospibrain_phase1_schemas.sql](C:/Users/USER/brain/hospibrain_phase1_schemas.sql:207) and `lib/shift-management.ts`; the original audit query was corrected accordingly.

Attendance remains minimal: employee, tenant, date, clock-in/out timestamps, notes, and free-text location. It has no shift FK, trusted location ID, source, device, confidence, evidence reference, correction, or approval fields.

### Kernel integration

The following server-only kernel tables exist with RLS enabled and forced:

- `brain_action_proposals`
- `brain_domain_events`
- `brain_event_outbox`

They have no ordinary RLS policies and table grants are limited to `postgres` and `service_role`. Their constraints and indexes match the Stage 0C/K5/K8 direction, including proposal idempotency, domain-event logical uniqueness, outbox command/event uniqueness, tenant idempotency, and pending-delivery indexes.

No generic employee command, employee event, employee idempotency, employee audit, or employee outbox table exists.

## 4. Constraints, indexes, and triggers

### Employee and identity

- `employees`: primary key only; no secondary live indexes.
- `profiles`: PK plus role/status checks; indexes on company, employee, role, and status.
- `profiles.employee_id` is indexed but not unique.
- Employee FKs independently reference company, location, and department; they do not prove common tenant ownership.
- Profile FKs independently reference company, employee, and auth user; they do not prove profile/employee tenant equivalence.
- Employee, company, department, and location use `update_timestamp()` triggers.

### Scheduling

Scheduling status checks exist for shifts, swaps, time off, and open shifts. Useful single-column indexes exist for company, employee, date, target/requestor, and status. Weekly schedules uniquely constrain `(company_id, employee_id, week_start_date)`.

No composite FK structurally binds tenant to employee, department, location, template, approver, creator, requestor, or target.

## 5. Functions and RPCs

Confirmed relevant live functions:

| Function | Security | Search path | Grants/effect |
|---|---|---|---|
| `private.current_user_company_id()` | Definer | Empty | Executable by authenticated and postgres |
| `private.can_manage_company(uuid)` | Definer | Empty | Executable by authenticated and postgres |
| `claim_brain_action_proposal(...)` | Definer | `public, pg_temp` | Service-role and postgres |
| `complete_brain_action_proposal(...)` | Definer | `public, pg_temp` | Service-role and postgres |
| `fail_brain_action_proposal(...)` | Definer | `public, pg_temp` | Service-role and postgres |
| `reject_brain_action_proposal(...)` | Definer | `public, pg_temp` | Service-role and postgres |
| `create_task_with_outbox_event(...)` | Definer | `public, pg_temp` | Service-role and postgres |

PostgREST separately exposed `update_own_full_name`; repository auth SQL defines it as the focused self-profile update boundary.

No live function name indicates canonical employee create/update/delete, employee/profile linking, attendance, leave, or shift mutation. Current employee and scheduling mutations therefore rely on direct table operations plus RLS.

The export intentionally did not include function bodies. Tables read/written and validation details for Stage 0C/K8 are corroborated by their ordered repository migrations and focused tests, but function-body equivalence cannot be proven from the absent migration-history table. Confidence: medium-high for K8 because it was live-smoke-tested; medium for general repository/live function parity.

## 6. Migration history and repository parity

Read-only Query 9.2 returned:

```text
42P01: relation supabase_migrations.schema_migrations does not exist
```

Therefore the database does not expose standard Supabase CLI migration history at that location. Repository-to-live parity cannot be established by version rows.

Presence and structural evidence confirms the applied outcomes of Stage 0C, K5, and K8, but not a complete ordered history for the older schema. Standalone root SQL files remain the only checked-in definitions for many live objects.

This is a **High** migration-safety issue for D1.2B: the first employee migration must treat the live catalog as authoritative and must not assume all root SQL files were applied exactly.

## 7. Repository-versus-live drift matrix

| Area | Repository | Live | Classification |
|---|---|---|---|
| Employee `department` | Missing from `employees_schema.sql`; used by Brain | Non-null text column exists | Live/code only; SQL drift |
| Employee `department_id` | Present in repository schema | Nullable UUID exists | Match |
| Employee `position` | Selected by Brain reads | No live column | Code selects missing live column |
| Employee `start_date` | Selected by Brain summary | No live column; `hire_date` exists | Code selects missing live column |
| Employee status | UI/AI vocabularies conflict | Unconstrained; `active` and typo `actie` present | Same name, inconsistent meaning/value |
| Employment type | Repository default `full-time` | `full-time` and `full time` present | Vocabulary drift |
| Employee role | Free text/job/manager semantics | `manager`, `owner`, `employee` values | Overloaded meaning |
| Profile role | Constrained authorization role | All current rows `super_admin` | Correctly constrained but separate meaning |
| Profile link | Optional indexed FK | No live links; no uniqueness | Partially supported |
| Shift swaps | Repository uses `requestor_id` | `requestor_id` | Match; audit query corrected |
| Shifts | Duplicate SQL definitions differ on nullability/names | Live uses nullable `created_by_id` | Duplicate-definition uncertainty |
| Attendance | Repository and live use free-text location | Same | Match with unsafe semantics |
| Tasks assignee FK | K8 validates assignee in RPC | No live FK from tasks to employees found | RPC/application validation only; deletion can orphan |
| Kernel migrations | Ordered files exist | Objects/functions structurally present | Applied outcome confirmed; history unverifiable |
| Skills/certifications/positions | Architectural expectation only | No tables found | Absent |

## 8. Employee data quality

Only aggregate evidence was collected.

| Metric | Count |
|---|---:|
| Employees | 5 |
| Tenant buckets | 1 |
| Missing company | 0 |
| Missing location | 5 |
| Missing department | 5 |
| Missing hire date | 2 |
| Missing email | 3 |
| Missing phone | 3 |
| Missing salary | 0 |
| Missing first/last name | 0 / 0 |
| Duplicate-name groups | 0 |

Vocabulary evidence:

- Status: `active` = 4; invalid typo `actie` = 1.
- Employment type: `full-time` = 4; `full time` = 1.
- Legacy employee role: `manager` = 2; `owner` = 2; `employee` = 1.

Confirmed data-quality blockers:

- One invalid lifecycle spelling.
- Two representations of full-time employment.
- All employees lack normalized location and department assignments.
- The employee role field contains authorization-like values rather than canonical positions.
- Contact completeness is 40%; Brain Score currently treats missing contact fields as employee quality input.

## 9. Profile and employee linkage

| Metric | Count |
|---|---:|
| Auth users | 2 |
| Profiles | 2 |
| Active profiles | 2 |
| `super_admin` profiles | 2 |
| Profiles linked to employees | 0 |
| Profiles without employee link | 2 |
| Nonexistent employee links | 0 |
| Profile/employee tenant mismatches | 0 |
| Employees with multiple profiles | 0 |

The absence of bad links is caused by having no links, not by sufficient constraints. Self-service employee identity cannot currently be derived from `profiles.employee_id`. A future link remains vulnerable to duplicate profile assignment because the column is not unique.

## 10. Tenant-integrity audit

Current aggregate data contains no detected company, department, location, profile, shift, attendance, time-off, swap, or task tenant mismatch. This is a positive current-data finding, not structural protection.

| Relationship | Live protection | Classification |
|---|---|---|
| Profile → employee | Independent FK, RLS, no composite tenant constraint | RLS/application only; structurally unsafe |
| Employee → department/location | Independent FK, RLS | RLS/application only |
| Department → manager/location | Independent FK, RLS | RLS/application only |
| Shift → employee/department | Independent FK, row-company RLS | RLS/application only |
| Attendance → employee | Independent FK; insert checks row company only | Unsafe: arbitrary/cross-tenant employee ID possible if known |
| Attendance → shift/location | No shift FK; location free text | Unprotected/absent |
| Time off → employee | Independent FK; insert checks row company only | Unsafe: arbitrary employee ID possible |
| Shift swap → employees | Independent FKs; insert checks row company only | Unsafe: arbitrary requestor/target IDs possible |
| Task → employee | No FK found; K8 RPC validates canonical create-task path | RPC validation for K8; legacy/direct paths unsafe |
| Skills/certifications → employee | No live objects | Absent |

Current operational counts:

- Tasks: 10; 9 employee assignments; no missing/cross-tenant assignee detected.
- Shifts: 1; no missing, inactive, or cross-tenant employee/department relationship detected.
- Attendance, time off, and shift swaps: zero rows.

The zero-row tables provide no behavioral evidence that their policies prevent spoofing.

## 11. Privacy and authorization audit

### Critical findings

1. **Anonymous company CRUD is explicitly enabled.** Live policies named `Temporary public read/insert/update/delete companies` apply to `anon` with unconditional `true` expressions. Combined with broad anon table grants, unauthenticated PostgREST callers can read and mutate company rows.
2. **Employee PII and compensation are exposed through a general tenant-wide row.** The employee table contains phone, email, salary, and notes. `employees_select` permits every active same-company user to select the table; there is no safe column projection or column-level restriction.

### High findings

1. `attendance_records_select` and `time_off_requests_select` allow every active same-company user to read all rows, including attendance notes, free-text location, leave reason, and approval linkage.
2. Attendance, time-off, and swap INSERT policies validate row `company_id` and active user status but do not bind employee/requestor IDs to the actor or validate referenced employee tenant ownership.
3. `profiles_select_company` permits active same-company profile listing, exposing full name, authorization role/status, and employee linkage to all active company users.
4. Employee delete is available to users satisfying `can_manage_company`, while many dependent historical records cascade.

### Grant interpretation

Most public tables grant all table privileges to `anon` and `authenticated`. RLS blocks many row operations, but the grants create a broad attack surface and make policy mistakes immediately exploitable. RLS is not forced on ordinary workforce tables. Kernel proposal/event/outbox tables are materially safer: forced RLS, no ordinary policies, and service-role/postgres-only grants.

### Exposure classification

| Data | Current exposure | Severity |
|---|---|---:|
| Company records | Anonymous unconditional CRUD | Critical |
| Employee directory | All active same-tenant users | Expected only if safe projection existed |
| Private phone/email | Same broad employee read | Critical |
| Salary | Same broad employee read | Critical |
| Employee notes | Same broad employee read | Critical |
| Employment status | Same broad employee read | Medium |
| Profile/auth linkage | Active same-company profiles | High |
| Attendance | Active same-company users | High |
| Leave/time-off reasons | Active same-company users | High |
| Documents/performance | No dedicated live objects found | Not currently exposed through dedicated tables |

## 12. Mutation-path audit

| Path | Trust/authority | Kernel guarantees | Principal risk |
|---|---|---|---|
| Employee UI create | Browser payload includes company, salary, role, status, assignment | None beyond auth/RLS | Client-selected tenant/sensitive fields |
| Employee API POST | Auth user plus direct Supabase insert | No ActorContext, TenantScope, command, idempotency, event, or transaction | Direct wide-row mutation; raw DB error exposure |
| Employee UI/API update | Browser sends company and sensitive fields; direct update | None beyond auth/RLS | Tenant and lifecycle mutable from client payload |
| Employee API DELETE | Auth user; direct delete; RLS manager check | No lifecycle command/event | Destructive history loss |
| Brain `create_employee` | Auth tenant plus Stage 0C proposal approval | K7 registry, but legacy executor bypasses K3–K6/K8 | No employee application service/event/outbox/idempotent mutation |
| Profile link | No focused employee-link RPC found | None | Service/manual mutation; duplicate and tenant mismatch possible |
| Attendance insert | Client-selected employee and company row; RLS active-company check | None | Employee impersonation/cross-tenant reference risk |
| Time-off insert | Client-selected employee and company row | None | Employee impersonation risk |
| Shift-swap insert | Client-selected requestor/target and company row | None | Arbitrary employee relationship risk |
| K8 create task | Trusted ActorContext/TenantScope/CommandEnvelope and approved registry path | Atomic task + outbox, idempotency, event delivery | Canonical and working; employee only validated as assignee |

Repository evidence includes [employee POST](C:/Users/USER/brain/app/api/employees/route.ts:37), [employee PATCH/DELETE](C:/Users/USER/brain/app/api/employees/[id]/route.ts:25), and [EmployeeForm](C:/Users/USER/brain/components/EmployeeForm.tsx:94).

## 13. Deletion and history risk

An employee hard delete currently has the following structural effects:

```text
employees DELETE
├─ CASCADE: announcement_acknowledgments
├─ CASCADE: attendance_records
├─ CASCADE: recurring_shifts
├─ CASCADE: shift_swaps.requestor_id
├─ CASCADE: shift_swaps.target_employee_id
├─ CASCADE: shifts
├─ CASCADE: time_off_requests
├─ CASCADE: weekly_schedules
├─ SET NULL: departments.manager_employee_id
├─ SET NULL: maintenance_tickets.assigned_to_id
├─ SET NULL: open_shifts.filled_by_employee_id
├─ SET NULL: profiles.employee_id
└─ NO FK: tasks.assigned_employee_id may become orphaned
```

The live employee API exposes physical DELETE. There is no canonical termination or archival operation. This is a **Critical destructive-history risk** because attendance, shifts, leave, recurring schedules, swaps, and acknowledgments can disappear permanently.

## 14. Enum and vocabulary drift

| Concept | Live values/shape | Conflict |
|---|---|---|
| Employee status | `active`, invalid `actie`; unconstrained | UI/AI also use inactive, terminated, suspended |
| Profile status | active/inactive/suspended check; current active only | Auth state is distinct from employment lifecycle |
| Employment type | `full-time`, `full time`; unconstrained | Hyphenated versus spaced; D1.1 canonical snake case absent |
| Employee role | manager/owner/employee; unconstrained | Mixes job, hierarchy, and authorization semantics |
| Profile role | super_admin/owner/manager/employee check | Authorization role; all current profiles super_admin |
| Roles table | Tenant-scoped named roles plus JSON permissions | Separate third role concept without employee assignment |
| Position/job title | No canonical table/column | Brain maps job title into department/employee role |

## 15. K1–K8 compatibility

| Guarantee | Employee flows | K8 create-task path |
|---|---|---|
| ActorContext | Bypassed | Used |
| TenantScope | Ad hoc/RLS/browser field | Used |
| CommandEnvelope | Bypassed | Used |
| Command handler/application service | Bypassed | Used |
| Durable idempotency | Absent | Enforced |
| Approved action registry | Brain create only, legacy executor | Canonical registry path |
| Atomic mutation | Absent | Task + outbox atomic RPC |
| Domain event/outbox | Absent | `task.created` obligation |
| Correlation/causation | Absent | Preserved |
| Safe result contract | Inconsistent/raw errors in API | Preserved |

All employee UI/API mutations and the legacy approved `create_employee` path bypass the complete K3–K8 guarantees. K1–K8 code and the working create-task path were not modified.

## 16. Brain Score dependency

[brainScoreService.ts](C:/Users/USER/brain/lib/brainScoreService.ts:139) reads employee `id`, `status`, `email`, `phone`, and `role` directly.

Current calculation:

- 70 points from the proportion whose status exactly equals `active`.
- Up to 30 points for contact/role completeness, deducting 3 points per incomplete employee.
- Empty or failed employee data is effectively treated as score 100.

The invalid `actie` row is counted as inactive. Three employees missing email/phone reduce the score. No salary, notes, or documents are used, and Brain Score does not write employee records. Its direct-table coupling and misleading empty-result behavior remain D1 follow-up concerns, not D1.2A changes.

## 17. Live-to-canonical compatibility matrix

| D1.1 canonical concept | Live status |
|---|---|
| Employee aggregate UUID/tenant | Partially supported |
| `lifecycle_status` | Supported with unsafe semantics and dirty vocabulary |
| Employee number | Absent |
| Aggregate version | Absent |
| Employment relationships/history | Absent |
| Positions | Absent |
| Effective organizational assignments | Absent; nullable direct fields/text only |
| Manager/reporting line | Partial department manager; unsafe tenant semantics |
| Private employee details | Colocated unsafely in employee row |
| Compensation | Colocated unsafely in employee row |
| Profile linkage | Partial; optional, nonunique, currently unused |
| Skills/certifications | Absent |
| Availability | Absent |
| Scheduling | Present with legacy normalized/denormalized mix |
| Attendance provenance | Absent |
| Attendance corrections | Absent |
| Perception evidence references | Absent |
| Safe employee projection | Absent |
| Employee domain commands | Absent |
| Employee domain events | Absent |
| Employee transactional outbox | Absent |

## 18. Severity-ranked findings

### Critical

1. Anonymous unconditional CRUD policies on `companies`.
2. Salary, private contact data, and notes exposed by tenant-wide employee reads.
3. Employee hard deletion cascades through attendance and scheduling history.
4. Missing authoritative migration history makes an assumption-based employee migration unsafe.

### High

1. No structural tenant integrity across workforce relationships.
2. Attendance, time-off, and swap creation can select arbitrary employee IDs.
3. Employee mutation paths bypass K1–K8 guarantees.
4. Profile/employee link is nonunique and currently absent for all profiles.
5. Attendance and leave details are tenant-wide readable.
6. Tasks have no employee FK and can orphan after deletion.
7. Broad anon/authenticated grants make RLS policy mistakes immediately consequential.

### Medium

1. Invalid status and employment-type values already exist.
2. No employee secondary indexes or employee-number uniqueness.
3. Organization assignments are incomplete for all five employees.
4. Duplicate SQL definitions and live-only employee fields complicate compatibility.
5. Brain Score directly depends on administrative contact completeness.

### Low

1. Inconsistent naming such as `requestor_id` versus conventional `requester_id` is maintainability debt; it is not live/repository drift.
2. Several scheduling structures are denormalized and may limit future evolution.

## 19. Blocking issues for D1.2B

D1.2B must resolve by design, not by immediate remediation:

1. Decide how migration history will be baselined when the standard history relation is absent.
2. Define a reviewed mapping for `actie` and employment-type spelling variants.
3. Decide whether legacy employee `role` values map to authorization, position, or neither; no automatic inference is safe.
4. Define the compatibility treatment of live non-null `employees.department` while introducing normalized assignments.
5. Define how salary/contact/notes are removed from broad projections without breaking current UI.
6. Define no-hard-delete behavior while preserving all existing employee UUID references.
7. Define same-tenant database guarantees for employee relationships.
8. Define profile-link cardinality and migration despite zero current links.
9. Inventory and retire the temporary anonymous company policies in a separately approved security change.
10. Preserve the live K8 create-task path and its employee assignment validation.

No migration SQL should be generated until these decisions are approved.

## 20. Human decisions required

1. Should current `owner`/`manager`/`employee` employee-role values become positions, legacy labels, or be manually mapped?
2. What should the invalid `actie` row map to after human review?
3. Is `employees.department` meaningful legacy business data, a required display value, or removable after normalized assignment backfill?
4. Which roles may read private contact details, compensation, notes, attendance, and leave reasons?
5. Should existing auth profiles be linked to existing employees, or are they administrative identities intentionally outside the workforce?
6. What is the canonical policy for rehire versus new employee creation?
7. Should historical employee deletion be prohibited universally, including privileged administrative paths?
8. Should D1.2B include the anonymous company-policy remediation, or should it be handled first as a separate urgent security stage?
9. What source should establish the migration baseline: a new approved baseline record, external deployment records, or a catalog snapshot?

## 21. Recommendations

1. Treat anonymous company CRUD as the first security remediation requiring separate approval.
2. Keep D1.2B architecture/migration planning additive and catalog-first; do not rewrite existing migrations.
3. Preserve employee UUIDs and prohibit physical deletion before any workforce normalization.
4. Split safe directory data from private contact, compensation, and notes.
5. Introduce same-tenant structural validation before enabling new mutation paths.
6. Migrate one employee command path onto K1–K8 at a time; do not build a generic workflow or command bus.
7. Preserve K8 create-task behavior and use its focused atomic outbox pattern as precedent.
8. Require a reviewed data mapping for every existing status, employment type, role, and department value.
9. Keep camera/perception, Brain Score redesign, payroll, and new hospitality features outside D1.2B.

## 22. Evidence provenance and limitations

Evidence sources:

- Consolidated read-only export sections 01–23
- Query 9.2 `42P01`
- Corrected Query 14.4/15.2 using `requestor_id`
- Repository files and ordered migrations inspected during D1.1/D1.2A

Limitations:

- Aggregate counts are a point-in-time development snapshot.
- Zero violations do not prove constraints, especially for empty attendance/leave/swap tables.
- Function bodies were not exported; K8 behavior is corroborated by repository migration/tests and prior live smoke testing.
- No policy was exercised with impersonated roles; conclusions derive from catalog policy definitions and grants.
- The missing migration-history relation prevents version-by-version deployment reconstruction.

## 23. Final confirmation

- D1.2A audit evidence has been incorporated.
- No personal employee data appears in this report.
- No database mutation, schema change, migration, backfill, seed, or reset occurred.
- No application or K1–K8 code was modified.
- No D1.2B, D1.3, or K9 work began.
- The only modified deliverable for completion is this audit report.
