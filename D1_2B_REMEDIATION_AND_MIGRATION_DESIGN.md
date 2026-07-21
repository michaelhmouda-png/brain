# D1.2B Employee Domain Remediation and Migration Design

## 1. Status and scope

**Design only. Not approved for execution.**

This document converts the approved D1.2A live audit into a phased remediation and migration plan. It defines intended boundaries, rollout sequencing, compatibility, validation, rollback, and risks.

It does not contain executable migration DDL and does not authorize:

- Database changes
- Application changes
- Data backfills
- D1.3 implementation
- K9
- Payroll, camera, Brain Score, scheduling-feature, or hospitality-feature expansion

The existing K8 `create_task` application path, RPC signature, proposal lifecycle, atomic task/outbox transaction, event envelope, and delivery behavior must remain unchanged.

## 2. Approved baseline

D1.2A established these authoritative facts:

1. Anonymous unconditional CRUD policies exist on `public.companies`.
2. Employee salary, phone, email, and notes share the generally tenant-readable `employees` row.
3. Employee deletion cascades through attendance and scheduling history.
4. `supabase_migrations.schema_migrations` does not exist (`42P01`).
5. `employees.status` and `employment_type` are unconstrained and contain dirty values.
6. All current profiles are unlinked from employees; `profiles.employee_id` is nonunique.
7. Current aggregate data has no detected tenant mismatches, but tenant integrity is not structurally enforced.
8. Employee UI/API/Brain mutations bypass the complete K1–K8 guarantees.
9. Stage 0C/K5/K8 proposal, domain-event, and outbox objects are live and server-only.
10. K8 create-task is the canonical working command path and must not regress.

## 3. Design principles

1. **Security closure precedes domain expansion.** Anonymous company access is remediated before workforce migrations.
2. **Live catalog is authoritative.** Root SQL files are evidence, not assumed migration history.
3. **Forward-only and additive.** Existing applied migrations are never rewritten.
4. **Expand, migrate, contract.** New structures and compatibility reads precede removal of legacy authority.
5. **No hard deletion.** Workforce history is preserved through lifecycle transitions and restrictive references.
6. **Tenant integrity is structural.** Application validation and RLS remain defense-in-depth.
7. **Sensitive data is capability-scoped.** General directory access never implies compensation or private-record access.
8. **One canonical mutation path at a time.** No generic bus, workflow engine, saga, plugin system, or DI container.
9. **Human, API, and AI callers converge.** They use the same application service and command contract.
10. **K8 remains stable.** Employee work must not alter task command/event behavior.

## 4. Target bounded contexts

| Context | Owns | Boundary |
|---|---|---|
| Identity and Access | Auth user, profile, authorization role/capability | Does not own employment lifecycle or position |
| Workforce | Employee identity, lifecycle, employment relationships, assignments | Does not own login sessions, shifts, attendance facts, or perception evidence |
| Organization | Company, location, department, position definitions | Does not own employee lifecycle |
| Scheduling | Shifts, templates, schedules, swaps, time off | References eligible employees; preserves history |
| Attendance | Attendance facts, provenance, corrections | Does not mutate employee lifecycle |
| Audit/Governance | Immutable evidence and sensitive-access audit | Does not replace source records |
| Kernel | Actor, tenant, command, event, proposal, outbox guarantees | Remains focused; no generic workflow framework |

## 5. Canonical vocabularies

### 5.1 Employee lifecycle status

Canonical stored values:

| Value | Meaning | Permitted operational assignment |
|---|---|---:|
| `draft` | Incomplete workforce record not yet operational | No |
| `active` | Current worker eligible for ordinary operations | Yes |
| `on_leave` | Temporarily unavailable under an active relationship | No new assignment by default |
| `inactive` | Retained record, not currently operational | No |
| `terminated` | Employment ended; history retained | No |
| `archived` | Terminal administrative retention state | No |

Rules:

- `suspended` remains an Identity/Profile status, not an Employee lifecycle status.
- `invited` belongs to identity onboarding, not employment lifecycle.
- `leave` is normalized to `on_leave` only when the source meaning is verified.
- `actie` must not be automatically mapped merely because it resembles `active`; a human-reviewed mapping decision is required.
- Transition validation belongs in the Employee application service and focused transactional persistence boundary.
- Every nontrivial transition records effective time, actor, reason code, command, and event.

### 5.2 Employment type

Canonical stored values:

- `full_time`
- `part_time`
- `casual`
- `seasonal`
- `contractor`
- `intern`

Approved deterministic candidate mappings for review:

| Legacy value | Candidate canonical value |
|---|---|
| `full-time` | `full_time` |
| `full time` | `full_time` |

No unknown value is silently coerced. Unknown or ambiguous values must enter an exception report and block constraint validation for affected rows.

### 5.3 Role vocabulary separation

- `profiles.role`: application authorization only.
- `positions`: job/operational titles.
- `employees.role`: legacy compatibility value only during transition.
- `roles` table: existing tenant permission definitions; not automatically treated as positions.

Existing employee values `owner`, `manager`, and `employee` require an explicit human mapping. Authorization must never be derived from a job position or legacy employee role.

## 6. Target data model

### 6.1 Evolved employee root

The current employee UUID remains stable.

Target Employee root responsibilities:

- Immutable `company_id`
- Tenant-scoped `employee_number`
- Legal and preferred display identity
- Canonical `lifecycle_status`
- Optimistic concurrency `version`
- Lifecycle timestamps
- Archive metadata
- Creation/update audit metadata

The legacy columns remain temporarily for compatibility but cease being authoritative in the contraction phase.

### 6.2 Employment relationships

A new effective-dated relationship structure should own:

- Employee and tenant
- Canonical employment type
- Start/end dates
- Relationship status
- Probation end, when required
- Termination reason code
- Restricted termination notes/reference
- Effective and audit metadata

It preserves rehire history rather than overwriting `hire_date`.

### 6.3 Positions and organizational assignments

Positions are tenant-owned definitions. Effective-dated employee assignments bind:

- Employee
- Position
- Location
- Department
- Optional reporting employee
- Primary flag
- Effective interval

At most one primary assignment may be active at a time unless a later explicitly approved business rule permits otherwise.

The live non-null `employees.department` text remains a compatibility field until its meaning has been inventoried and mapped. It must not be silently discarded.

### 6.4 Sensitive employee data

Use separate restricted structures:

| Structure | Data | Access intent |
|---|---|---|
| Employee directory/root | Safe display identity, operational lifecycle, canonical primary assignment reference | Ordinary same-tenant directory users |
| Private details | Private phone/email and future address/emergency-contact references | Employee self, authorized HR/owner capabilities |
| Compensation | Amount, currency, type, effective interval | Explicit compensation capability only |
| Confidential notes | Categorized restricted notes or secure document reference | Explicit HR/governance capability; audited |

Do not put arbitrary JSON or free-form private notes back into the directory/root record.

### 6.5 Safe projections

Introduce explicit server/read-model projections:

- Employee directory projection
- Employee self projection
- Workforce manager projection
- Private-details projection
- Compensation projection

Ordinary clients must eventually lose direct table access to the base Employee and sensitive tables. RLS and grants should authorize projections or focused server functions, not broad physical rows.

## 7. Profile-to-employee linking strategy

Cardinality:

```text
auth.users 1 ── 1 profiles 0..1 ── 1 employees
employees 1 ── 0..1 profiles
```

Rules:

1. An employee may exist without a login.
2. A profile may exist without an employee link.
3. One employee may link to at most one profile in D1.
4. Profile and employee must belong to the same tenant.
5. Linking and unlinking occur only through trusted server commands.
6. Browser or AI payload cannot select actor, profile, or tenant.
7. Link does not confer authorization; `profiles.role` remains authoritative for application capability.
8. Profile suspension does not terminate employment.
9. Employee termination triggers a separately governed access-revocation decision; no implicit auth-user deletion.
10. Unlinking preserves both employee history and auth audit evidence.

Structural target:

- A unique constraint/index for non-null `profiles.employee_id`.
- Composite tenant integrity between profile `(company_id, employee_id)` and employee `(company_id, id)`.
- A pre-constraint validation showing zero duplicate links and zero tenant mismatches.
- No automatic linking by matching names, email addresses, or phone numbers.

Because both live profiles are currently unlinked, every initial link requires explicit operator review.

## 8. Structural tenant enforcement

### 8.1 Pattern

For tenant-owned parent records, establish a unique candidate key `(company_id, id)`. Child relationships that also carry `company_id` reference the composite key.

This pattern should cover, where columns exist:

- Profile → employee
- Employee → location/department
- Department → location/manager employee
- Position assignment → employee/position/location/department/reporting employee
- Shift → employee/department
- Attendance → employee/shift/location
- Time off → employee
- Shift swap → requestor/target employee
- Open shift → filled employee/template
- Recurring/weekly schedules → employee/templates
- Task → assigned employee
- Skills/certifications → employee

### 8.2 Constraint rollout

1. Inventory nulls, orphans, and tenant mismatches.
2. Add supporting unique/index structures.
3. Add tenant constraints in a nonblocking/unvalidated form where PostgreSQL supports it.
4. Validate existing data explicitly.
5. Validate constraints separately.
6. Only then make application paths depend on them.

RLS remains required. Composite constraints do not replace authorization; they prevent structurally invalid relationships regardless of caller.

### 8.3 K8 task compatibility

The live K8 RPC already validates the assignee tenant and active profile. A future composite task-assignee FK may be added only after confirming all task assignments pass validation.

It must not change:

- RPC name or arguments
- Task result projection
- Proposal claim/completion behavior
- Idempotency semantics
- `task.created` event schema
- Outbox delivery behavior
- Registry contract

## 9. History preservation and deletion policy

### 9.1 Canonical policy

Normal employee deletion is prohibited. Employee lifecycle commands replace DELETE:

- Deactivate
- Start/end leave
- Terminate
- Archive
- Reactivate or rehire under explicit rules

### 9.2 Foreign-key direction

Historical/factual records must use `RESTRICT` or retained-reference semantics, not `CASCADE`, including:

- Attendance
- Shifts and schedule publication
- Time off
- Shift swaps
- Recurring/weekly schedule history
- Announcement acknowledgments

Operational assignment pointers may use `SET NULL` only when loss of the current assignment does not erase historical identity. Historical rows should retain stable employee references.

Tasks require a real tenant-safe employee FK or an explicit retained-reference strategy; they must not silently orphan.

### 9.3 Transition safety

Changing delete actions is performed only after:

- Hard-delete UI/API access is disabled through canonical application behavior.
- Existing orphan checks pass.
- Retention expectations are approved.
- Restore and rollback behavior is rehearsed in development.

No employee row is deleted to test these changes.

## 10. K1–K8 employee mutation design

### 10.1 Initial command set

- `CreateEmployee`
- `UpdateEmployeeIdentity`
- `ChangeEmployeeLifecycleStatus`
- `LinkEmployeeProfile`
- `UnlinkEmployeeProfile`
- `AssignEmployeePosition`
- `EndEmployeePositionAssignment`
- `UpdateEmployeePrivateDetails`
- `ChangeEmployeeCompensation`

Only the minimum command required by each rollout stage is implemented. This is not a generic command bus.

### 10.2 Required envelope and trust boundary

Every employee mutation must preserve:

- Actor ID from authenticated identity
- Profile ID from provisioned profile
- Tenant ID from TenantScope
- Command ID
- Correlation ID
- Causation ID
- Idempotency key
- Command type/version
- Server-controlled timestamps

Client or AI inputs may contain only mutable business intent. They never select actor, profile, tenant, authorization, event metadata, payload hash, or execution metadata.

### 10.3 Application boundary

Each path follows:

```text
authenticated caller
  → provisioning / ActorContext / TenantScope
  → validated CommandEnvelope
  → focused employee command handler
  → Employee application service
  → focused atomic persistence + outbox obligation
  → safe result projection
```

AI mutation additionally uses Stage 0C approval and K7 registry before the same application service. The existing legacy `create_employee` executor is retired only after parity tests prove the canonical path.

### 10.4 Employee events

Initial events should be versioned safe facts:

- `employee.created`
- `employee.identity_updated`
- `employee.lifecycle_changed`
- `employee.profile_linked`
- `employee.profile_unlinked`
- `employee.position_assigned`
- `employee.position_assignment_ended`
- `employee.private_details_updated` without private values
- `employee.compensation_changed` without amount

Event payloads exclude private contact data, salary/amount, notes, documents, and protected information.

## 11. Rollout order

### Stage B0 — Urgent anonymous company-access closure

Purpose: remove the live critical unauthenticated CRUD path before workforce expansion.

Design:

- Remove the four `Temporary public ... companies` policies.
- Remove unnecessary anon company table privileges.
- Preserve authenticated tenant-scoped select and super-admin management policies.
- Verify signup/provisioning does not rely on anonymous direct company writes.

This should be a separately deployable, narrowly reviewed security correction. It precedes all employee migration work.

### Stage B1 — Migration baseline and observability

- Record a reviewed live-catalog baseline because standard migration history is absent.
- Define forward migration naming/order from the accepted baseline.
- Capture pre-deployment counts and constraint fingerprints.
- Do not claim older root SQL files as applied history.

### Stage B2 — Add canonical employee foundation

- Add employee number, lifecycle, version, and lifecycle audit fields additively.
- Add canonical vocabulary support without immediately removing legacy columns.
- Introduce safe directory projection.
- Do not yet switch writers.

### Stage B3 — Sensitive-data separation

- Add private-details, compensation, and confidential-note structures.
- Backfill through an explicitly approved, deterministic migration later.
- Compare counts/hashes structurally without exporting values.
- Switch authorized reads to focused projections.
- Revoke broad base-table reads only after read-path parity.

### Stage B4 — Employment and organizational normalization

- Add employment relationships, positions, and effective assignments.
- Preserve legacy `department`, `department_id`, `location_id`, `role`, and `hire_date` for compatibility.
- Map only approved values; report exceptions.

### Stage B5 — Profile linking

- Add same-tenant and uniqueness protection.
- Introduce focused link/unlink commands.
- Perform operator-reviewed initial links; never infer from PII.

### Stage B6 — Tenant relationship hardening

- Add composite protections progressively.
- Validate empty and populated operational tables.
- Add task-assignee protection without changing K8 behavior.

### Stage B7 — History-preserving lifecycle

- Add canonical lifecycle mutation service.
- Disable employee hard-delete entry points.
- Replace destructive FK cascades on historical employee dependencies.
- Verify historical reads and retention.

### Stage B8 — Canonical create/update employee path

- Implement the minimum K1–K8 employee application service and atomic outbox path.
- Migrate human/API callers first.
- Migrate Brain `create_employee` through the same service after parity.
- Remove reachability of legacy direct mutation only after regression verification.

### Stage B9 — Contract legacy fields

- Stop compatibility writes.
- Prove no production reader depends on legacy sensitive/overloaded columns.
- Revoke or remove legacy fields only in a later separately approved destructive stage.

## 12. Compatibility strategy

### Expand

- Preserve employee UUIDs.
- Add canonical structures alongside live columns.
- Keep current read shapes through server-owned compatibility projections.
- Keep K8 task assignment and results unchanged.

### Migrate

- Backfill only reviewed mappings.
- Dual-read and compare, but avoid independent application dual writes.
- When legacy and canonical representations must change together, use one focused transaction.
- Track unmapped status, employment type, role, department, and profile-link exceptions.

### Contract

- Switch callers to safe projections and application services.
- Remove client-selected tenant and actor fields.
- Revoke broad sensitive reads.
- Disable hard delete.
- Retire direct employee mutation and legacy Brain executor.
- Remove legacy columns only after a separately approved proof of non-use.

## 13. Rollback and recovery plan

Rollback is stage-specific; destructive down migrations are not the default.

| Stage | Forward recovery / rollback approach |
|---|---|
| B0 company policy closure | Re-enable only a reviewed minimum authenticated flow; never restore unconditional anon CRUD as routine rollback |
| Additive tables/columns | Leave unused structures in place; route reads/writes back to prior path |
| Safe projections | Restore previous server projection temporarily while retaining new data |
| Sensitive read switch | Revert application read routing only under incident approval; do not broadly reopen table access |
| Vocabulary migration | Preserve legacy source values until mapping is verified; reverse canonical reads, not original evidence |
| Profile links | Unlink through audited command; never delete profile/employee |
| Composite constraints | Stop rollout before validation/enforcement; fix design/data through separately approved forward action |
| Delete-action hardening | Keep more restrictive behavior; do not restore destructive cascades as emergency rollback |
| Canonical mutation | Feature-route callers back only while legacy path remains deliberately available and audited; never replay failed outbox mutations automatically |

Before each deployment:

- Capture schema metadata and aggregate counts.
- Record application version and migration identifier.
- Confirm backup/PITR posture through the platform operator.
- Define a go/no-go threshold and responsible approver.

## 14. Validation plan

All pre-deployment checks are read-only. Migration execution/testing belongs to later approved stages.

### 14.1 Anonymous company closure

Catalog validation must show:

- No `anon` policy with unconditional `true` on companies.
- No unnecessary anon mutation privileges on companies.
- Authenticated tenant read and approved management policies remain.

Runtime validation later must use an anonymous client and prove company select/insert/update/delete are denied without mutating real data; use policy simulation or an isolated transaction in an approved test environment.

### 14.2 Sensitive data

Read-only validation:

```sql
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('employees', 'employee_private_details', 'employee_compensation');
```

Required result after rollout: ordinary roles cannot directly read private/compensation storage; safe projection columns exclude salary, private contact, and notes.

### 14.3 Vocabulary readiness

```sql
SELECT status, count(*) FROM public.employees GROUP BY status ORDER BY status;
SELECT employment_type, count(*) FROM public.employees GROUP BY employment_type ORDER BY employment_type;
```

Required result before constraint validation: every legacy value appears in an approved mapping or exception list; no silent coercion.

### 14.4 Profile linking

```sql
SELECT count(*) AS tenant_mismatches
FROM public.profiles AS p
JOIN public.employees AS e ON e.id = p.employee_id
WHERE p.company_id IS DISTINCT FROM e.company_id;

SELECT count(*) AS duplicate_employee_links
FROM (
  SELECT employee_id
  FROM public.profiles
  WHERE employee_id IS NOT NULL
  GROUP BY employee_id
  HAVING count(*) > 1
) AS duplicates;
```

Both counts must be zero before structural enforcement.

### 14.5 Tenant integrity

For every composite relationship, validate:

- No missing parent
- No tenant mismatch
- No invalid null combination
- Supporting unique/index structure exists
- Constraint is validated

The D1.2A aggregate queries are retained as the baseline and rerun before and after each relevant stage.

### 14.6 History preservation

Catalog validation must show no `ON DELETE CASCADE` from historical workforce tables to employees. Aggregate reference counts before and after migration must match. No deletion is performed as validation.

### 14.7 K1–K8 and K8 regression

Required later verification:

- K1–K8 focused tests
- Stage 0A–0C tests
- K8 Supabase-backed atomicity plan
- Existing create-task live smoke test
- Exact K8 RPC signature comparison
- `task.created` schema/result comparison
- Proposal and outbox constraint fingerprints

Any K8 signature, event, result, idempotency, or lifecycle drift is a release blocker.

## 15. Acceptance criteria

D1 remediation is not complete until:

1. Anonymous company CRUD is unreachable.
2. Ordinary tenant users cannot read salary, private contact details, or confidential notes.
3. Employee hard deletion is unreachable through normal application paths.
4. Attendance, shifts, schedules, swaps, leave, acknowledgments, and tasks retain valid employee history.
5. Employee lifecycle and employment type use constrained canonical vocabularies.
6. Every legacy value is mapped or explicitly blocked for review.
7. Profile links are optional, unique, same-tenant, and server-controlled.
8. Cross-tenant workforce relationships fail at the database boundary.
9. Employee mutations use ActorContext, TenantScope, CommandEnvelope, application service, durable idempotency, atomic mutation/outbox, and safe results.
10. Human/API/AI employee mutation converges on the same service.
11. The legacy direct/client-trusted employee mutation path is unreachable.
12. K8 create-task behavior is unchanged and fully passing.

## 16. Risk analysis

| Risk | Severity | Mitigation |
|---|---:|---|
| Breaking provisioning when closing anonymous company policies | Critical | Trace provisioning first; deploy narrow policy correction; verify authenticated/admin flow |
| Leaking sensitive data during compatibility | Critical | Server-owned projections, explicit grants, access tests, no raw-table client reads |
| Destroying workforce history | Critical | Disable hard delete, replace cascades, compare reference counts |
| Incorrect mapping of `actie`, role, or department text | High | Human-reviewed exception set; preserve source values |
| Locking/availability during FK validation | High | Supporting indexes, staged nonblocking validation, low-traffic deployment |
| Breaking K8 task creation | High | No RPC/application contract change; pre/post signature and smoke verification |
| Duplicate/incorrect profile link | High | No PII inference; unique/same-tenant constraints; operator review |
| Mixed canonical/legacy writes diverge | High | One transactional writer; short compatibility window; reconciliation signals |
| RLS grant interaction misunderstood | High | Test roles explicitly; minimize grants as well as policies |
| Missing migration history causes ordering collision | High | Approved baseline and new forward-only sequence |
| Empty operational tables hide policy defects | Medium | Structural tests and isolated policy simulation later |
| Overbuilding workforce abstractions | Medium | Deliver one vertical command path at a time |

## 17. Proposed migration package sequence

Names are planning identifiers only; no files are created in D1.2B.

1. `d1_security_close_anonymous_company_crud`
2. `d1_employee_foundation_expand`
3. `d1_employee_sensitive_data_expand`
4. `d1_employment_positions_assignments_expand`
5. `d1_profile_employee_link_constraints`
6. `d1_workforce_tenant_integrity_constraints`
7. `d1_employee_history_preservation`
8. `d1_employee_command_transactional_outbox`
9. `d1_employee_legacy_contract` only after proof and separate approval

Every package must be additive/corrective, independently reviewed, and paired with focused tests and deployment instructions.

## 18. Decisions required before implementation

1. Approve a separate urgent security correction for anonymous company CRUD.
2. Approve the canonical status and employment-type vocabularies.
3. Decide the reviewed mapping for `actie`.
4. Decide how legacy employee roles map to positions, if at all.
5. Decide whether live `employees.department` is retained as a display label or only migration evidence.
6. Define capabilities for private contact, compensation, confidential notes, attendance, and leave.
7. Decide which profiles, if any, should link to existing employees.
8. Approve universal prohibition of normal employee hard deletion.
9. Approve the baseline mechanism for future migration tracking.
10. Approve whether task-assignee composite integrity belongs in the tenant-hardening package while keeping K8 otherwise unchanged.

## 19. Recommended next review

Review and approve decisions in this order:

1. Anonymous company-policy closure
2. Privacy capability matrix
3. Lifecycle and employment vocabulary mappings
4. No-hard-delete and retention policy
5. Profile-link cardinality and operator workflow
6. Tenant-integrity constraint pattern
7. First canonical employee command path

Implementation should not begin until the relevant decision subset and exact stage scope are approved.

## 20. Final confirmation

- This is a design document only.
- No SQL migration or application implementation was created.
- No database was accessed or changed.
- No existing migration was modified.
- K1–K8 and the K8 create-task path were not modified.
- D1.3 and K9 were not started.
