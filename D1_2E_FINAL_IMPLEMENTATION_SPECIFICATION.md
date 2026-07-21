# D1.2E Final Employee Domain Implementation Specification

## 1. Status, authority, and boundary

This document is the final implementation specification for D1.2. It is derived from and subordinate to the approved:

- `D1_2A_LIVE_SCHEMA_AND_EMPLOYEE_DATA_AUDIT.md`
- `D1_2B_REMEDIATION_AND_MIGRATION_DESIGN.md`
- `D1_2C_IMPLEMENTATION_READY_MIGRATION_AND_ROLLOUT_PACKAGE.md`
- `D1_2D_HUMAN_DECISION_REGISTER.md`

The D1.2D recommended options are treated here as approved policy decisions. Approval of a policy does not substitute for production evidence that D1.2D expressly requires a human to supply. In particular, this specification does not guess the meaning of `actie`, compensation metadata, confidential-note metadata, profile/employee UUID pairings, organizational mappings, or live foreign-key names.

This is a documentation-only release gate. It creates no migration, contains no executable migration SQL, changes no database or application state, and authorizes no deployment. Migration files must not be created until this specification receives separate approval.

## 2. Final approved decisions and prerequisite disposition

| Decision | Final approved rule | Implementation consequence | Remaining evidence gate |
|---|---|---|---|
| Anonymous company access | Permanently remove the four temporary anonymous company CRUD policies and all `anon` company privileges. Legitimate provisioning must use a narrow authenticated/server boundary. | Migration 010 is the first production change. Rollback must never restore unconditional anonymous CRUD. | Prove current provisioning does not depend on anonymous direct company access. |
| Catalog baseline | The reviewed live catalog is authoritative because `supabase_migrations.schema_migrations` is absent (`42P01`). Store an append-only, server-only SHA-256 fingerprint, sanitized counts, and an approval reference. | Migration 011 records deployment evidence without claiming unverified historical migrations were applied. | Capture and approve the deployment-time fingerprint and change-ticket/approval reference. |
| Lifecycle vocabulary | Canonical employee lifecycle values are `draft`, `active`, `on_leave`, `inactive`, `terminated`, and `archived`. Identity states such as `suspended` remain separate. | Migration 012 adds canonical lifecycle state while preserving the legacy field during compatibility. Unknown values are exception records, not coerced values. | An authorized workforce owner must determine the single `actie` row's evidenced state. |
| `actie` | Never automatically translate `actie` to `active`. Preserve the original evidence and record reviewer, time, reason, and source reference for the chosen canonical state. | Universal canonical completion and eligibility-dependent operations remain blocked for that row until reviewed. | Exact reviewed disposition is mandatory. |
| Employment type | Canonical values are `full_time`, `part_time`, `casual`, `seasonal`, `contractor`, and `intern`. Exact `full-time` and `full time` values map to `full_time`; all other values enter the exception register. | Migration 014 may backfill only deterministic approved mappings. | Any newly discovered value requires human review before deployment continues. |
| Legacy role/department/hire date/rehire | Legacy role never grants authorization and is not automatically mapped to a position. Department and position mappings are human-reviewed. Relationship start dates require evidence. Rehire normally preserves the employee UUID and creates a new effective-dated relationship. | Migration 014 builds canonical structures without inferring authority or organization from free text. | Reviewed mappings and evidenced start dates for every row included in backfill. |
| Private contact | Existing phone and email are private. Employees may read/update approved fields for themselves; owners or an explicit HR capability may access others when operationally necessary. Managers receive no sensitive access merely from role. Super-admin use requires explicit tenant context and an audited reason. | Migration 013 copies contact data exactly into server-only private storage. Broad directory projections must exclude it after application cutover. | Inventory and update all readers/writers before contraction. |
| Compensation | Owner or explicit compensation capability only. Never infer currency, compensation type, or effective date. | Migration 013 creates restricted effective-dated storage, but moves an amount only after tenant/operator metadata approval. | ISO currency, `salary`/`hourly`, effective date, and reconciliation approval per source record/set. |
| Confidential notes | Owner or explicit HR/governance capability only. Notes are append-only confidential records and never enter events or outbox payloads. | Migration 013 creates restricted storage but does not bulk-copy unclassified notes. | Approved category, accountable creator/reference, purpose, and retention treatment for each migrated note. |
| Profile/employee link | Optional one-to-one, same-company UUID relationship. No name, email, or phone matching. Owner/super-admin performs human-verified linking. Unlink is audited and preserves both records; linking does not grant a role. | Migration 015 adds uniqueness and same-tenant constraints without automatic backfill. | Exact reviewed UUID pairs and operator approval for each link operation. |
| Employee deletion | Normal application hard deletion is prohibited for every ordinary role, including super-admin. Use lifecycle transitions with actor, effective time, and reason. | Migration 017 removes destructive normal deletion. A future never-operational draft purge would require a separate design. | Confirm all direct-delete callers have been removed or release-gated. |
| Historical foreign keys | Historical facts use `ON DELETE RESTRICT`: attendance, shifts, weekly/recurring schedules, time off, both shift-swap employee references, acknowledgments, tasks, profiles, and new employment history. `SET NULL` is retained only for reviewed current operational pointers. | Migrations 015–017 preserve joins and prevent history loss. | Capture exact live constraint names/definitions and verify all reference counts. |
| Tenant integrity | Add parent `(company_id, id)` uniqueness, then bounded composite foreign keys, initially unvalidated and validated in controlled windows. Include task assignee integrity without altering K8. | Migration 016 provides structural isolation in addition to RLS/application checks. | Zero orphan/mismatch results and acceptable lock rehearsal for each constraint group. |
| K1–K8 convergence | The first employee vertical slice is `CreateEmployee`; `ChangeEmployeeLifecycleStatus` follows before delete entry points are retired. Human/API routes converge first, then Brain after parity. No generic command bus is authorized. | Migration 018 provides only the focused receipt, outbox, and one atomic command persistence boundary. | Final command schema/version, authorization matrix, safe result, and application parity acceptance must match this specification. |
| Employee event | `employee.created` version 1 contains only employee UUID and non-sensitive lifecycle/organizational facts. Delivery is at least once, idempotent for identical redelivery, fail-closed for conflict, and never replays the mutation. | Migration 018 stores a durable safe outbox obligation and exposes a stuck-pending operational signal. | Final safe-field allowlist review; no contact, compensation, note, document, or authority data. |
| Legacy contraction | Migration 019 is reserved and separately destructive. Prefer early broad-read revocation after parity and later physical column removal. | 019 is not created or deployed with 010–018. | All readers/writers migrated, reconciliation clean, Brain Score migrated, rollback rehearsed, verified PITR, zero legacy use for two normal release cycles and one agreed operating cycle, plus separate approval. |

## 3. Final migration order

The exact order is fixed as follows. Existing migrations are never edited.

1. `202607210010_d1_security_close_anonymous_company_crud.sql`
2. `202607210011_d1_employee_catalog_baseline.sql`
3. `202607210012_d1_employee_foundation_expand.sql`
4. `202607210013_d1_employee_sensitive_data_expand.sql`
5. `202607210014_d1_employment_positions_assignments_expand.sql`
6. `202607210015_d1_profile_employee_link_constraints.sql`
7. `202607210016_d1_workforce_tenant_integrity_constraints.sql`
8. `202607210017_d1_employee_history_preservation.sql`
9. `202607210018_d1_employee_command_transactional_outbox.sql`
10. Reserved only: `202607210019_d1_employee_legacy_contract.sql`

Migrations 010–018 are additive or security-hardening stages. Migration 019 is a later contraction and requires an independent destructive-change approval. If migration 016 must be divided to control locks, only release-approved ordered `016a`–`016n` units may be used, without changing its logical position or scope.

## 4. Migration specifications

### 4.1 Migration 010 — close anonymous company CRUD

- **Purpose:** Remove only the four audited temporary anonymous CRUD policies on `public.companies` and remove `anon` table privileges while preserving reviewed authenticated policies.
- **Dependencies:** None in the D1 sequence.
- **Can proceed immediately:** Yes, but only after the global go/no-go gate and an explicit provisioning trace prove no legitimate flow uses anonymous direct company CRUD.
- **Blocking decisions:** No policy decision remains. Operational proof of provisioning compatibility remains mandatory.
- **Preflight checks:** Verify the four exact temporary policies exist; capture all current company policies/grants; verify intended authenticated select/insert/update/delete policies and grants; trace signup/provisioning; confirm backup/PITR and the deployment role.
- **Deployment checkpoint:** Apply 010 alone in a controlled window. Do not combine it with 011 or employee-domain changes.
- **Validation checkpoint:** Prove anonymous select/insert/update/delete are denied in a safe isolated test; prove intended authenticated and privileged company behavior still works; confirm no temporary anonymous policy or `anon` privilege remains; observe signup/provisioning.
- **Rollback checkpoint:** Keep anonymous access closed. If a legitimate flow breaks, deploy a separately reviewed narrow authenticated/server boundary or restore only an accidentally removed authenticated grant after confirming its RLS policies. Never recreate unconditional anonymous policies.
- **Application compatibility risk:** Critical if provisioning currently relies on anonymous direct writes; otherwise low. This is the highest-priority security correction.

### 4.2 Migration 011 — employee catalog baseline

- **Purpose:** Record an append-only, server-only catalog fingerprint, aggregate counts, baseline version, and approval reference because standard migration history is unavailable.
- **Dependencies:** Successful 010 and an approved deployment-time catalog capture.
- **Can proceed immediately:** After 010 validation and approval of the captured fingerprint/reference.
- **Blocking decisions:** None; D1.2D fixed the method. A missing or unexpected object is an evidence blocker, not a design choice.
- **Preflight checks:** Capture schemas, relations, columns, constraints, indexes, policies, grants, owners, relevant function signatures/security settings, aggregate row counts, vocabularies, duplicate links, tenant mismatches, and the exact K8 function fingerprint. Confirm the migration version remains unused.
- **Deployment checkpoint:** Create only the restricted checkpoint structure and append the approved baseline record. Do not reconstruct or fabricate older migration history.
- **Validation checkpoint:** Confirm forced RLS, server-only privileges, immutable accepted fingerprint evidence, correct baseline version, and equality with the approved sanitized capture.
- **Rollback checkpoint:** Leave evidence intact but unused if the sequence stops. Accepted fingerprint records are never rewritten or deleted as rollback.
- **Application compatibility risk:** Very low; the object is server-only and not on runtime read paths.

### 4.3 Migration 012 — employee foundation and canonical lifecycle

- **Purpose:** Add lifecycle/version/archive fields, tenant-safe employee identity indexes, and a restricted migration-exception register while retaining legacy fields.
- **Dependencies:** 011; approved lifecycle vocabulary and exception policy.
- **Can proceed immediately:** Conditionally. The additive schema and exact `active` mapping may proceed after preflight. The `actie` row must remain an exception until its human disposition is supplied; no universal non-null canonical assertion or eligibility-dependent migration may treat it as active.
- **Blocking decisions:** All policy decisions are resolved. Record-specific `actie` disposition and any newly discovered vocabulary values remain blockers to canonical completion.
- **Preflight checks:** Recount exact legacy status/employment-type values; confirm the hashing capability exists without installing an unapproved extension; verify no duplicate employee numbering/index conflicts; confirm profile/archive references are valid; approve the `actie` review record if available.
- **Deployment checkpoint:** Add nullable canonical state, versioning, archive metadata, indexes, and the server-only exception register. Map only exact approved values and preserve every legacy source value.
- **Validation checkpoint:** Validate allowed lifecycle values and positive version/archive shape; prove `active` rows map deterministically; prove `actie` and unknown values are not coerced; verify exception rows contain hashes/metadata rather than personal values; run legacy employee-read and K8 regressions.
- **Rollback checkpoint:** Stop using new columns and structures while retaining them and all source evidence. Do not erase exception records or reverse lifecycle evidence destructively.
- **Application compatibility risk:** Moderate. Legacy readers remain compatible, but any early canonical reader must handle unresolved/null lifecycle state explicitly.

### 4.4 Migration 013 — sensitive employee-data expansion

- **Purpose:** Introduce separate server-only storage for private contact details, effective-dated compensation, and confidential notes; copy contact values exactly while preserving legacy columns.
- **Dependencies:** 012 and the approved sensitive-access matrix.
- **Can proceed immediately:** Partially. Restricted tables and exact phone/email copy can proceed after reader/writer inventory. Compensation and note backfills cannot proceed until their required record metadata is approved.
- **Blocking decisions:** None at policy level. Currency/type/effective-date evidence blocks compensation rows; category/creator/purpose/retention evidence blocks note rows.
- **Preflight checks:** Count source rows/nulls without exporting values; identify every reader/writer, report, export, Brain tool, and Brain Score dependency; confirm employee composite keys; approve capability enforcement boundaries; collect compensation/note metadata where migration is intended.
- **Deployment checkpoint:** Create forced-RLS, service-role-only structures. Copy phone/email exactly. Do not fabricate compensation or note metadata. Keep legacy fields during compatibility.
- **Validation checkpoint:** Compare contact row counts and values inside the database; prove ordinary authenticated users have no direct private-table access; test self/owner/approved-capability boundaries through server projections; verify safe directory and event outputs contain no salary, private contact, or notes.
- **Rollback checkpoint:** Keep restricted copies, disable new routing if required, and continue compatible legacy server reads temporarily. Never delete either representation or broaden direct access.
- **Application compatibility risk:** High. Expansion alone does not close broad legacy-row exposure; declaring privacy closure before application cutover and 019 controls is prohibited.

### 4.5 Migration 014 — employment relationships, positions, and assignments

- **Purpose:** Add tenant-owned, effective-dated employment relationships, positions, and organizational assignments with canonical employment types.
- **Dependencies:** 012; approved employment vocabulary and reviewed organization/start-date mappings.
- **Can proceed immediately:** Schema expansion may proceed after preflight. Production backfill is blocked for any row lacking an evidenced start date or reviewed position/department mapping.
- **Blocking decisions:** No policy decision remains. Row-level mapping evidence remains mandatory; legacy role never grants authority.
- **Preflight checks:** Re-enumerate employment types; verify only the two approved full-time spellings are auto-mapped; inventory missing hire dates and current relationships; review position, department, location, reporting, and rehire mappings; verify tenant-parent composite uniqueness can be added.
- **Deployment checkpoint:** Create server-only tenant-scoped structures and indexes. Backfill only approved deterministic relationship data. Send unknowns to the exception process; never infer authorization or position from legacy labels.
- **Validation checkpoint:** Prove canonical vocabulary, valid effective intervals, one current relationship and one current primary assignment as designed, same-company references, preserved legacy data, and no role-authority side effect.
- **Rollback checkpoint:** Leave new structures unused and retain legacy fields/read paths. Do not delete effective-dated records or rewrite legacy evidence.
- **Application compatibility risk:** High for forms, filters, Brain, and reports that assume free-text `role`, `department`, or `hire_date`; low while expansion remains unused.

### 4.6 Migration 015 — profile/employee link constraints

- **Purpose:** Enforce optional one-to-one, same-company profile-to-employee linkage without automatic matching or data backfill.
- **Dependencies:** 012 and a valid employee `(company_id, id)` key.
- **Can proceed immediately:** Constraint deployment can proceed if live preflight shows zero duplicate links, zero tenant mismatches, and no link without company. Actual link operations require separately reviewed exact UUID pairs.
- **Blocking decisions:** None. Human identity verification blocks each data-link operation but does not block an empty/valid structural constraint deployment.
- **Preflight checks:** Count duplicate non-null employee links, profile/employee tenant mismatches, missing linked employees, and links without a company. Review exact operator permissions and audited unlink behavior.
- **Deployment checkpoint:** Add partial uniqueness, company-required shape, and same-company composite FK using restrictive deletion behavior. Perform no guessed backfill.
- **Validation checkpoint:** Prove null links remain valid; duplicates, cross-company links, and missing employees fail; exact approved same-company links succeed through the trusted path; linking changes no canonical role.
- **Rollback checkpoint:** Correct a bad approved link with the audited unlink command while preserving both records. Do not remove tenant/uniqueness constraints as routine rollback.
- **Application compatibility risk:** Moderate. Unlinked users must receive a safe explicit error; self-service must not assume every administrative profile has an employee record.

### 4.7 Migration 016 — workforce tenant-integrity constraints

- **Purpose:** Add structural same-company enforcement for employee relationships across employees, departments, locations, shifts, attendance, leave, swaps using live `requestor_id`, schedules, open shifts, and task assignees.
- **Dependencies:** 014 and 015 where their parent keys/relationships are involved; supporting parent unique indexes; zero mismatch/orphan evidence.
- **Can proceed immediately:** Only after every relationship group passes preflight and lock rehearsal. It may be released in approved bounded `016a`–`016n` units if needed.
- **Blocking decisions:** None. Any orphan or mismatch blocks the affected unit and requires a separate evidence-based remediation approval; automatic reassignment/deletion is forbidden.
- **Preflight checks:** For every child/parent pair, confirm column names/types/nullability, parent uniqueness, current FK definitions, zero orphan IDs, zero tenant mismatches, supporting indexes, and expected lock/runtime impact. Fingerprint the K8 task RPC before the task-assignee unit.
- **Deployment checkpoint:** Add supporting indexes first, then composite constraints as unvalidated where supported, and validate one bounded group at a time during controlled traffic. The task FK is structural only.
- **Validation checkpoint:** Prove valid same-company writes succeed and cross-company writes fail for each relation; compare row/reference counts; rerun RLS isolation tests; confirm exact K8 RPC signature, grants, result, proposal, event, outbox, and idempotency behavior are unchanged.
- **Rollback checkpoint:** Before validation, an affected newly added unvalidated constraint may be removed through a reviewed recovery. After validation, prefer forward data/application correction. Never weaken tenant isolation to accommodate an invalid write.
- **Application compatibility risk:** High if hidden legacy writers produce cross-company references; controlled for valid data. Constraint validation can create operational lock risk.

### 4.8 Migration 017 — workforce history preservation

- **Purpose:** Replace employee-directed destructive cascades with restrictive historical foreign keys, retain the approved `SET NULL` operational pointers, remove ordinary direct employee-delete authorization, and make lifecycle transitions the normal path.
- **Dependencies:** 016; exact live FK capture; all normal hard-delete callers release-gated.
- **Can proceed immediately:** No. It proceeds only after exact live constraint names/definitions are captured and reviewed, reference counts are archived, and application/API/Brain delete paths are removed or safely blocked.
- **Blocking decisions:** None. Operational caller readiness and exact catalog evidence remain hard gates.
- **Preflight checks:** Capture every FK to employees and delete action; confirm no unresolved template token; archive counts for attendance, shifts, weekly/recurring schedules, time off, both swap references, acknowledgments, profiles, tasks, maintenance/open-shift pointers, and audit/event records; inventory direct delete grants/policies/callers.
- **Deployment checkpoint:** Replace only audited historical cascades with restrictive behavior, preserve reviewed operational `SET NULL` pointers, drop the ordinary employee-delete policy, and revoke authenticated direct delete. Do not delete an employee as deployment validation.
- **Validation checkpoint:** Catalog inspection shows no historical employee FK with cascade; before/after child counts and joins match; normal hard delete is denied; lifecycle flows work; maintenance/open-shift/department pointers retain their approved semantics.
- **Rollback checkpoint:** Keep restrictive history protection and fix callers forward. Restoring destructive cascades or broad delete access is not an approved rollback.
- **Application compatibility risk:** Critical for any remaining delete UI/API. Positive for history integrity; release is blocked until callers use lifecycle semantics.

### 4.9 Migration 018 — focused CreateEmployee transactional outbox

- **Purpose:** Add server-only command receipts, a dedicated safe employee event outbox, and exactly one atomic `CreateEmployee` persistence RPC following K1–K8 guarantees without creating a generic command system.
- **Dependencies:** 012, relevant 013 access controls, 015, and 017; final canonical CreateEmployee contract and safe event allowlist.
- **Can proceed immediately:** No. Database objects may be authored only after this specification is approved, and deployment requires application contract/parity review plus completion of dependencies.
- **Blocking decisions:** None at architecture level. The implementation must freeze command/event versions, transition/authorization rules, public safe result, payload hash, and non-sensitive event fields before release.
- **Preflight checks:** Verify Stage 0C proposal and K1–K8 boundaries; inventory all human/API/Brain create-employee paths; define canonical validated payload with no client-selected authority; confirm receipt/outbox names do not collide; fingerprint K8 objects; prepare database-backed atomicity, concurrency, idempotency, and delivery-failure tests.
- **Deployment checkpoint:** Add forced-RLS server-only receipts/outbox and one service-role-only, safe-search-path atomic RPC. In one transaction validate actor/profile/company/role, canonical payload and proposal where applicable, claim idempotency, create the employee, store a safe deterministic result, and add one `employee.created` v1 obligation. Migration 018 does not itself route callers.
- **Validation checkpoint:** Prove unauthorized/inactive/cross-tenant calls fail; client authority spoofing fails; identical retries return the same safe result; conflicting reuse fails closed; any mutation/outbox failure commits neither; delivery failure leaves pending and never reruns creation; event/result/logs contain no contact, compensation, notes, documents, or role authority; stuck-pending signal is safe; K1–K8 and K8 regressions remain green.
- **Rollback checkpoint:** Disable new caller routing while retaining receipts and outbox obligations. Never delete receipts/events, replay failed mutations automatically, or route Brain before parity. A pending delivery may be retried idempotently without rerunning employee creation.
- **Application compatibility risk:** High during caller convergence. Human/API callers move first; Brain follows only after parity. Existing safe response shapes should remain stable where practical.

### 4.10 Reserved migration 019 — legacy employee contract

- **Purpose:** Eventually revoke broad legacy employee-row access/writes and only then remove or neutralize legacy sensitive/overloaded columns after complete cutover.
- **Dependencies:** Successful 013/014/018 application adoption and reconciliation; Brain Score migration; all readers/writers migrated; no unresolved mappings; verified backup and rollback rehearsal.
- **Can proceed immediately:** No. It must not be created with 010–018 and is not authorized by this specification.
- **Blocking decisions:** Separate destructive approval is required. Production must show zero legacy use for at least two normal release cycles and one complete operations-approved hospitality cycle.
- **Preflight checks:** Inventory every UI, API, server action, Brain tool, report, export, integration, and Brain Score reader/writer; reconcile canonical/source values; resolve all exception records; verify sensitive RLS/capability tests; confirm PITR and rehearse recovery. Prefer separately reviewed grant revocation before physical removal.
- **Deployment checkpoint:** Reserved. A later specification must define whether access contraction and physical removal are separate migrations.
- **Validation checkpoint:** Prove ordinary users cannot access sensitive legacy values, all canonical workflows remain functional, no telemetry shows legacy dependency, and all historical/evidentiary data remains intact.
- **Rollback checkpoint:** Before column removal, revert application routing only without reopening sensitive access. After removal, recovery requires a reviewed forward restore from canonical data or PITR—not ad hoc schema recreation.
- **Application compatibility risk:** Critical and the highest in the sequence. Premature execution can break every employee consumer and provoke an unsafe broad-access rollback.

## 5. Final dependency graph

```text
Production go/no-go
  |
  v
010 Close anonymous company CRUD
  |
  v
011 Record authoritative catalog baseline
  |
  v
012 Employee lifecycle/version/exception foundation
  |\
  | +--> 013 Sensitive-data expansion ------------------------+
  |                                                           |
  +----> 014 Employment/positions/assignments --+              |
  |                                             |              |
  +----> 015 Profile/employee constraints ------+              |
                                                v              |
                                  016 Tenant-integrity FKs      |
                                                |              |
                                                v              |
                                  017 History preservation     |
                                                |              |
                                                +--------------+
                                                v
                                  018 CreateEmployee receipt/
                                      atomic mutation/outbox

013 + 014 + 018 application cutover/reconciliation
  + Brain Score migration
  + zero legacy usage evidence
  + separate destructive approval
                         |
                         v
               019 Legacy contraction (reserved)

K8 create_task contract -------------------------------- unchanged
```

Migration 013 is a direct dependency of 018 only where the selected CreateEmployee contract touches approved private data; sensitive values remain outside the event payload in all cases. Migration 016 depends on 014/015 only for relation groups using their new parent keys. Migration 017 follows the completed structural relationship review. No dependency authorizes 019 automatically.

## 6. Production deployment checklist

### 6.1 Release preparation

- [ ] Approve this D1.2E specification before authoring any migration file.
- [ ] Reserve and recheck unique migration prefixes 202607210010–202607210019 against the repository and deployed catalog.
- [ ] Create each migration only from its approved responsibility; do not edit prior migrations.
- [ ] Use transactional, schema-qualified, fail-closed migrations and explicit safe search paths for definer functions.
- [ ] Confirm production backup/PITR health and name the accountable deployment and rollback owners.
- [ ] Capture sanitized live catalog, policy, grant, function, constraint, vocabulary, and aggregate-count evidence immediately before deployment.
- [ ] Confirm no raw personal, compensation, note, document, or credential data enters deployment artifacts.
- [ ] Confirm all record-specific approvals are attached: `actie`, organization/start dates, compensation metadata, note classification, and exact profile/employee UUID pairs as applicable.
- [ ] Confirm every new restricted table has forced RLS and no `PUBLIC`, `anon`, or ordinary `authenticated` direct access.
- [ ] Rehearse cross-tenant, rollback, lock, atomicity, and K8 regression tests in an isolated Supabase environment representative of production.

### 6.2 Staged release

- [ ] Deploy 010 alone; validate anonymous denial and provisioning before continuing.
- [ ] Deploy 011; verify the recorded fingerprint matches the approved capture.
- [ ] Deploy 012; validate mappings/exceptions and stop on any unknown value.
- [ ] Deploy 013 only within approved backfill scope; do not migrate compensation or notes without metadata.
- [ ] Deploy 014 only for reviewed mappings; leave unapproved rows unresolved rather than guessing.
- [ ] Deploy 015 constraints without automatic linking; execute separately audited link commands only for approved UUID pairs.
- [ ] Deploy 016 in bounded relation groups with validation/lock observation between groups.
- [ ] Deploy 017 only after all normal hard-delete callers are gated and exact FK definitions are embedded.
- [ ] Deploy 018 persistence first, then route human/API callers, verify parity, and route Brain only afterward.
- [ ] Do not create or deploy 019 during this release sequence.
- [ ] At every checkpoint, stop on catalog drift, data mismatch, privilege expansion, reference-count change, unexplained error rate, or K8 drift.

## 7. Production validation checklist

- [ ] Anonymous company read/write/delete is denied; intended authenticated provisioning and company operations work.
- [ ] Baseline evidence is server-only, append-only, and matches the approved catalog.
- [ ] Canonical lifecycle and employment vocabularies accept only approved values; `actie` is not silently mapped.
- [ ] Legacy values remain intact during expansion and every unknown has an accountable exception path.
- [ ] Private contact, compensation, and confidential-note storage is forced-RLS and inaccessible directly to ordinary roles.
- [ ] Employees can access only approved self contact fields; manager role alone grants no sensitive access; owner/capability/super-admin tenant-context rules are enforced server-side.
- [ ] Sensitive data never appears in safe directory projections, events, outbox records, deterministic results, or logs.
- [ ] Profile links are optional, unique when present, same-company, human-verified, and do not grant roles.
- [ ] Every tenant relationship accepts valid same-company data and rejects cross-company data structurally.
- [ ] All historical FK reference counts and joins match predeployment evidence; no historical employee FK cascades.
- [ ] Ordinary direct employee delete is denied and lifecycle transitions preserve the employee UUID and history.
- [ ] CreateEmployee authorization comes from the current persisted ActorContext/TenantScope; client/model actor, company, role, or event metadata cannot broaden access.
- [ ] CreateEmployee mutation plus outbox is atomic, concurrency-safe, and durably idempotent; conflicting retries fail closed.
- [ ] `employee.created` v1 is safe, logically unique, and redeliverable without replaying mutation; stuck pending work has a safe operational signal.
- [ ] Stage 0A–0C, K1–K8, employee-domain, RLS, tenant, history, rollback, and application compatibility tests pass.
- [ ] The exact K8 `create_task` RPC signature, grants, result, proposal lifecycle, payload validation, task/outbox atomicity, event envelope, idempotency, delivery, and smoke behavior are unchanged.
- [ ] Monitoring shows no new authorization failures, tenant-integrity violations, destructive deletes, sensitive-data exposure, or unexplained operational regression.

## 8. Production rollback checklist

- [ ] Stop at the current checkpoint; do not continue dependent migrations.
- [ ] Preserve captured catalog, counts, receipts, events, outbox obligations, exceptions, and source values.
- [ ] For 010, keep anonymous access closed and repair a legitimate flow with a narrow authenticated/server boundary.
- [ ] For 011, leave accepted baseline evidence intact and unused; never rewrite it.
- [ ] For 012–015, disable new application routing and retain additive structures/source fields; correct mappings or links through audited forward actions.
- [ ] For 016, remove only a newly added unvalidated constraint when an approved recovery requires it; after validation, prefer forward correction and preserve isolation.
- [ ] For 017, keep restrictive deletion semantics; repair application callers instead of restoring cascades or direct deletion.
- [ ] For 018, disable new caller routing but retain receipts/outbox/events; do not automatically replay mutations or delete durable obligations.
- [ ] Never recover by deleting employee or historical rows, widening RLS, exposing service-role authority, restoring anonymous CRUD, or fabricating missing metadata.
- [ ] If a destructive future 019 stage has begun, follow its separately rehearsed PITR/forward-restore plan and its independent approval; do not improvise rollback.
- [ ] Re-run the validation checklist and obtain explicit incident/change-owner approval before resuming.

## 9. Exact go/no-go criteria before migration 010

Migration 010 is **GO** only when every item below is true:

1. This D1.2E specification has been explicitly approved, followed by separate approval to author and deploy migration 010.
2. The target Supabase project and deployment role are independently confirmed, with working PITR/backup and named rollback ownership.
3. A fresh sanitized catalog capture confirms the four exact temporary anonymous company policies, the expected `anon` grants, and the intended authenticated company policies/grants.
4. Signup, invitation, onboarding, and provisioning traces prove no legitimate operation depends on anonymous direct CRUD on `public.companies`; otherwise a narrow authenticated/server replacement is approved first.
5. An isolated security test proves the intended post-010 anonymous denial and authenticated behavior without risking production data.
6. Repository migration numbering is collision-free and `202607210010_d1_security_close_anonymous_company_crud.sql` is the next approved unit.
7. The 010 change contains only the anonymous company-access closure, preserves RLS and intended authenticated access, and contains no employee schema or application change.
8. Monitoring, support, deployment, and forward-recovery procedures are ready; nobody plans to restore unconditional anonymous access as rollback.
9. The predeployment K8 fingerprint and focused K8 regression baseline are recorded.
10. No unresolved catalog drift, policy mismatch, privilege discrepancy, credential exposure, or unauthorized production-data operation exists.

Any false, unknown, or unverified item is **NO-GO**. The deployment stops before migration 010; later migrations are not prepared as a workaround.

## 10. Stop conditions across migrations 010–018

Stop the sequence immediately for:

- a missing, renamed, or materially changed audited object;
- an unexpected status, employment type, role, department, or relationship value;
- any guessed identity, tenant, mapping, time, currency, classification, or creator metadata;
- duplicate profile links, orphan references, or tenant mismatches;
- a before/after row or historical-reference count difference not explicitly expected and approved;
- direct ordinary access to restricted private, receipt, or outbox storage;
- a definer function without an explicit safe search path or with excess grants;
- an application path selecting actor, profile, company, role, event metadata, or storage authority from client/model input;
- any K8 `create_task` contract, behavior, signature, result, event, outbox, proposal, idempotency, or authorization drift;
- lock impact, error rate, or runtime behavior outside the approved checkpoint tolerance.

Resolution requires a reviewed forward plan. It does not authorize automatic backfill, reassignment, deletion, policy widening, or migration rewriting.

## 11. Compatibility and release-risk summary

| Risk | Required control |
|---|---|
| Anonymous provisioning dependency | Trace before 010; provide a focused authenticated boundary rather than restoring public access. |
| Missing standard migration history | Treat the approved live catalog as authority and record immutable baseline evidence in 011. |
| Incorrect `actie` or organizational mapping | Human-reviewed exception/mapping; preserve source; never infer. |
| Sensitive data remains on the legacy row | Restricted expansion first, application cutover and telemetry next, contraction only in separately approved 019. |
| Salary/note semantic corruption | No backfill without currency/type/date or category/creator/purpose/retention evidence. |
| Profile impersonation or cross-tenant link | Exact UUID selection, same-company FK, uniqueness, audited link/unlink, no PII matching. |
| Destruction of workforce history | Lifecycle transitions, restrictive historical FKs, no ordinary hard delete. |
| Constraint validation locks | Supporting indexes, unvalidated constraints, bounded groups, controlled validation windows. |
| Legacy cross-tenant writer fails after hardening | Fail closed, diagnose caller, and correct forward; never relax isolation as convenience. |
| Employee command partial/duplicate mutation | One focused atomic RPC, durable receipt/outbox, deterministic safe result, conflict rejection. |
| Sensitive employee event leakage | Strict event allowlist and structural tests; no contact, compensation, notes, documents, or authority data. |
| K8 regression | No K8 modifications; fingerprint and regression/smoke checks at every dependent checkpoint. |
| Premature legacy contraction | Reserve 019 until parity, reconciliation, telemetry, operating-cycle, backup, and destructive-approval gates pass. |

## 12. Explicit exclusions and final confirmations

- The existing K8 `create_task` contract remains unchanged: no RPC signature, proposal lifecycle, payload, result, task/outbox transaction, event envelope, idempotency, delivery, authorization, or application routing change is included.
- D1.3 is not included or begun.
- K9 is not included or begun.
- This specification does not introduce a generic command bus, workflow engine, saga framework, plugin system, or broad event infrastructure.
- Migration 018 is limited to the approved focused `CreateEmployee` vertical slice and safe `employee.created` v1 obligation.
- Migration 019 remains reserved, uncreated, and separately gated.
- No migration file should be created until `D1_2E_FINAL_IMPLEMENTATION_SPECIFICATION.md` is reviewed and explicitly approved.

## 13. D1.2E completion boundary

D1.2E is complete when this specification is accepted as the final policy, dependency, deployment, validation, rollback, and go/no-go contract for migrations 010–018 and the reserved 019. Acceptance authorizes planning the next explicitly approved step only; it does not by itself authorize migration creation, database execution, application modification, D1.3, or K9.
