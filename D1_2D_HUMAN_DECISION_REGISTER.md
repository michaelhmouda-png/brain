# D1.2D Employee Domain Human Decision Register

## 1. Status and scope

**Decision register only. No migration or application implementation is authorized.**

This register extracts the unresolved approvals from `D1_2C_IMPLEMENTATION_READY_MIGRATION_AND_ROLLOUT_PACKAGE.md`. Recommendations favor tenant isolation, least privilege, history preservation, operational continuity, and narrow K1–K8 adoption suitable for a production hospitality operating system.

Migration references:

- `010`: anonymous company CRUD closure
- `011`: catalog baseline
- `012`: employee foundation
- `013`: sensitive-data separation
- `014`: employment/positions/assignments
- `015`: profile/employee links
- `016`: tenant-integrity constraints
- `017`: history preservation
- `018`: employee command/outbox pilot
- `019`: reserved legacy contraction; outside migrations 010–018

## 2. Decision register

### D1 — Anonymous company access and provisioning dependency

- **Exact issue requiring approval:** Confirm that signup/provisioning does not require anonymous direct CRUD on `public.companies`, and approve permanent removal of the four temporary anonymous policies and all `anon` company privileges.
- **Recommended option:** Close anonymous CRUD permanently. Route any legitimate provisioning through an authenticated, narrowly authorized server boundary. Never restore unconditional anonymous policies as rollback.
- **Alternative options:** Delay migration 010 while provisioning is traced; or introduce a focused authenticated provisioning RPC before 010. Retaining anonymous CRUD is not an acceptable production option.
- **Security impact:** Critical. Approval closes an unauthenticated tenant read/write/delete path.
- **Data-loss/history impact:** Prevents anonymous mutation or deletion of company records. No existing row is changed by the closure.
- **Application compatibility impact:** A legacy anonymous provisioning flow would fail until moved server-side. Existing authenticated policies remain.
- **Rollback implications:** Roll forward with a focused authenticated boundary. Do not restore `TO anon USING (true)` or `WITH CHECK (true)`.
- **Blocks 010–018:** **Yes: 010.** Because all later stages depend on 010, it transitively blocks 011–018.
- **Stages affected:** 010 directly; 011–018 by ordering.

### D2 — Catalog baseline and migration identity

- **Exact issue requiring approval:** The standard Supabase migration-history relation is absent. Approve the live-catalog fingerprint method, sanitized aggregate checkpoint, approval-reference format, and numbering beginning at `202607210010`.
- **Recommended option:** Treat the reviewed live catalog as authoritative; store an append-only, server-only SHA-256 fingerprint plus aggregate counts and change-ticket reference. Reserve 010–019 before implementation.
- **Alternative options:** Reconstruct history from independently verified deployment records; or maintain the approved baseline externally. Do not claim root SQL files were applied without evidence.
- **Security impact:** Prevents migrations from silently targeting an unexpected schema or policy state.
- **Data-loss/history impact:** No employee data changes. Incorrect baselining could cause later destructive constraint or policy changes.
- **Application compatibility impact:** None at runtime; adds a deployment control.
- **Rollback implications:** Leave checkpoint evidence intact and unused. Never rewrite an accepted fingerprint.
- **Blocks 010–018:** **Yes: 011–018.** It does not block 010.
- **Stages affected:** 011 directly; 012–018 transitively.

### D3 — Sensitive employee-data authorization matrix

- **Exact issue requiring approval:** Decide who may read and mutate private contact details, compensation, and confidential notes after they leave the broad employee row.
- **Recommended option:** Keep storage tables service-role-only. Allow employees to read/update approved fields in their own contact record; owner and an explicit future HR capability may read other employees' contact data; compensation and confidential notes require owner or explicit HR/governance capability. Managers receive no sensitive access merely because they are managers. Super-admin access requires an explicit authorized tenant context and an audited reason.
- **Alternative options:** Owner-only access to every sensitive category; or add named HR/payroll capabilities before cutover. Broad tenant-wide or role-by-job-title access is unacceptable.
- **Security impact:** Critical. Determines whether the current salary/contact/notes exposure is actually closed.
- **Data-loss/history impact:** None if expanded additively. Overly broad access causes privacy loss; overly narrow access may impede operations.
- **Application compatibility impact:** Existing screens that select the wide employee row must move to safe and capability-specific server projections before broad access is revoked.
- **Rollback implications:** Route reads temporarily to the legacy server projection under incident approval while retaining restricted copies. Never reopen direct sensitive-table access.
- **Blocks 010–018:** **Yes: 013 backfill/cutover and sensitive commands in 018.** Does not block 010–012.
- **Stages affected:** 013, 018, and reserved 019.

### D4 — Phone and email treatment

- **Exact issue requiring approval:** Decide whether existing employee phone/email values are private, which self-service fields are editable, and how compatibility reads transition.
- **Recommended option:** Copy values exactly into `employee_private_details`; classify them as private contact data. Permit self-read and validated self-update, with owner/approved HR access for operational necessity. Expose only deliberate non-private contact fields through a separate future directory projection—never assume existing phone/email is public.
- **Alternative options:** Owner/HR-only contact access; or individually classify a future work phone/email as directory-visible through an explicit new field. Do not reuse private values automatically.
- **Security impact:** High. Prevents tenant-wide leakage and identity correlation.
- **Data-loss/history impact:** Preserve the exact source values during expansion; do not clear legacy columns until parity and backup checks pass.
- **Application compatibility impact:** Employee directory, Brain Score, forms, and APIs currently reading `employees.phone/email` require later migration before contraction.
- **Rollback implications:** Keep both copies during compatibility and revert read routing only. Do not delete the restricted copy.
- **Blocks 010–018:** **Yes: contact cutover in 013 and private-detail mutation in 018.**
- **Stages affected:** 013, 018, reserved 019.

### D5 — Salary migration semantics

- **Exact issue requiring approval:** Existing salary values lack an approved currency, compensation type, and effective date needed for the effective-dated compensation table.
- **Recommended option:** Do not invent metadata. Require each tenant/operator to approve ISO 4217 currency, `salary` versus `hourly`, and effective date. Copy amounts exactly only after approval, preserve the original column through reconciliation, and restrict access to owner or explicit compensation capability.
- **Alternative options:** Keep legacy salary temporarily without canonical backfill; or import from an authoritative payroll source later. A guessed default currency/date is unacceptable.
- **Security impact:** Critical confidentiality impact; amounts must never enter safe directory, events, logs, or client-wide projections.
- **Data-loss/history impact:** Effective dating preserves compensation history. Guessing or overwriting would corrupt payroll evidence.
- **Application compatibility impact:** Salary forms/reports need a focused server contract before the legacy column is retired.
- **Rollback implications:** Leave canonical compensation unused and retain the source column. Never delete either representation during recovery.
- **Blocks 010–018:** **Yes: compensation backfill in 013 and compensation command in 018.**
- **Stages affected:** 013, 018, reserved 019.

### D6 — Private notes migration semantics

- **Exact issue requiring approval:** Existing free-text notes lack category, sensitivity, author, purpose, and retention metadata.
- **Recommended option:** Do not bulk-copy notes until a human reviewer assigns an approved category and accountable creator/reference. Store them as append-only confidential records; owner or explicit HR/governance capability only; never include note text in domain events or outbox payloads.
- **Alternative options:** Preserve notes solely in the legacy restricted source until manual classification; or archive encrypted exports under a separately approved retention process. Automatic generic categorization is unacceptable.
- **Security impact:** Critical because notes may contain personal, medical, disciplinary, or legal information.
- **Data-loss/history impact:** Manual classification preserves meaning and attribution. Silent rewriting or dropping risks evidentiary loss.
- **Application compatibility impact:** Existing note editors must become focused audited commands before contraction.
- **Rollback implications:** Retain source and canonical copies; disable new read routing rather than deleting records.
- **Blocks 010–018:** **Yes: notes backfill in 013 and notes mutation in 018.**
- **Stages affected:** 013, 018, reserved 019.

### D7 — Canonical employee lifecycle vocabulary

- **Exact issue requiring approval:** Approve canonical employee statuses and the treatment of every existing or future noncanonical value.
- **Recommended option:** Approve exactly `draft`, `active`, `on_leave`, `inactive`, `terminated`, and `archived`. Keep identity status such as `suspended` separate. Map only exact `active` automatically; place every unknown value in a restricted exception register and block constraint completion until reviewed.
- **Alternative options:** A smaller vocabulary without `draft`/`archived`; or a separate availability state. Any alternative requires revising D1.2B/D1.2C before migration. Free-text status is not recommended.
- **Security impact:** Controls assignment eligibility and prevents identity authorization from being inferred from employment state.
- **Data-loss/history impact:** Versioned lifecycle transitions preserve history; overwriting legacy values without evidence would lose meaning.
- **Application compatibility impact:** Existing filters, Brain tools, forms, and Brain Score require canonical-value compatibility before legacy contraction.
- **Rollback implications:** Keep nullable canonical status and legacy status during rollout; revert reads, not source evidence.
- **Blocks 010–018:** **Yes: completion of 012 and lifecycle portions of 018.**
- **Stages affected:** 012, 014, 017, 018, reserved 019.

### D8 — Human disposition of legacy `actie`

- **Exact issue requiring approval:** Determine the intended lifecycle state of the single audited `actie` row without assuming it is a typo for `active`.
- **Recommended option:** An authorized workforce owner reviews current employment evidence and explicitly selects one canonical status. If the person is currently employed and operational, record `active`; otherwise choose the evidenced state. Record reviewer, timestamp, reason, and source reference without personal data in migration artifacts.
- **Alternative options:** Leave canonical status null and block the constraint; or move the row to `draft` pending evidence. Automatic `actie` → `active` is prohibited.
- **Security impact:** Incorrect `active` could make an ineligible worker assignable; incorrect inactive/terminated could deny legitimate access or work.
- **Data-loss/history impact:** Preserve original `actie` as migration evidence until contraction.
- **Application compatibility impact:** Canonical status cannot become universally non-null until resolved.
- **Rollback implications:** Correct through an audited lifecycle/mapping decision; never erase the original evidence during rollout.
- **Blocks 010–018:** **Yes: 012 completion; may block eligibility-dependent 014/018 operations for that employee.**
- **Stages affected:** 012, 014, 018, reserved 019.

### D9 — Employment-type mapping

- **Exact issue requiring approval:** Approve canonical employment types and deterministic treatment of `full-time`, `full time`, and future unknown values.
- **Recommended option:** Approve `full_time`, `part_time`, `casual`, `seasonal`, `contractor`, and `intern`; map both known full-time spellings to `full_time`; send every other value to the exception register for human review.
- **Alternative options:** Use a smaller locally required vocabulary or add a separately defined type such as `temporary`. Changes must be approved before constraints. Preserving free text as authority is not recommended.
- **Security impact:** Moderate; affects eligibility and policy interpretation but must not grant application roles.
- **Data-loss/history impact:** Effective-dated relationships preserve original employment history. Unknowns remain unmapped rather than coerced.
- **Application compatibility impact:** Filters/forms must move from hyphenated/spaced values to canonical snake case.
- **Rollback implications:** Continue legacy reads and leave canonical relationships unused; source values remain intact.
- **Blocks 010–018:** **Yes: relationship backfill in 014 and related commands in 018.**
- **Stages affected:** 012 exception handling, 014, 018, reserved 019.

### D10 — Legacy role, department, hire date, and rehire meaning

- **Exact issue requiring approval:** Decide whether `employees.role` values map to positions, what legacy `department` text means, how missing `hire_date` is handled, and whether rehire reuses the employee aggregate.
- **Recommended option:** Never map authorization from `employees.role`. Treat role/department as migration evidence and manually map to tenant positions/departments. Require an evidenced relationship start date; use an explicit reviewed placeholder only if policy approves it. Rehire the same person under the same employee UUID with a new effective-dated relationship, unless legal identity policy proves a new aggregate is required.
- **Alternative options:** Retain role/department only as display labels; leave organization assignment absent; or create a new employee aggregate on rehire. Automatic owner/manager authorization mapping is prohibited.
- **Security impact:** High if legacy job labels accidentally grant permissions or cross organizational boundaries.
- **Data-loss/history impact:** Effective-dated assignments/relationships preserve old roles, departments, and employment periods.
- **Application compatibility impact:** Current UI/Brain readers of `role`, `department`, and `hire_date` require compatibility projections.
- **Rollback implications:** Keep legacy fields authoritative until reviewed mappings and read parity are complete.
- **Blocks 010–018:** **Yes: 014; affected create/update commands in 018.**
- **Stages affected:** 012 exception register, 014, 018, reserved 019.

### D11 — Profile-to-employee linking

- **Exact issue requiring approval:** Define link cardinality, authorized operator, exact initial UUID pairs, unlink behavior, and handling of administrative profiles with no employee record.
- **Recommended option:** Optional one-to-one link: a profile may be unlinked; an employee may have at most one profile; linked records must share company. Initial links require an owner/super-admin operator to select exact profile and employee UUIDs after human verification. No matching by name, email, or phone. Unlink is audited and preserves both records; linking never grants a role.
- **Alternative options:** Keep administrative profiles permanently unlinked; or later support multiple profiles per employee only through a new approved design. Automatic matching is unacceptable.
- **Security impact:** Critical for self-service identity and prevention of employee impersonation/cross-tenant access.
- **Data-loss/history impact:** Linking/unlinking changes references only and preserves both identity and workforce history.
- **Application compatibility impact:** Self-scoped tasks, attendance, and employee experiences become reliable only for linked users; unlinked users need an explicit safe error.
- **Rollback implications:** Use the audited unlink command. Do not remove uniqueness/tenant constraints or delete either row.
- **Blocks 010–018:** **Yes: operational use of 015 and link commands in 018. Structural constraints can deploy with no backfill after preflight.**
- **Stages affected:** 015, 016, 018.

### D12 — Deactivation, termination, archive, and physical deletion

- **Exact issue requiring approval:** Decide whether normal employee hard deletion is universally prohibited and which lifecycle operation replaces it.
- **Recommended option:** Prohibit hard deletion for every ordinary role, including super-admin application paths. Use `inactive` for nonoperational retention, `terminated` for ended employment, `archived` for terminal administrative retention, and `on_leave` for temporary absence. Require reason/effective time/actor; preserve the employee UUID. Database-owner emergency deletion is break-glass only and outside normal application behavior.
- **Alternative options:** Permit hard delete only when a never-operational draft has no references, under a separately designed purge command. General privileged deletion is not recommended.
- **Security impact:** Prevents destructive abuse and preserves accountability.
- **Data-loss/history impact:** Critical. Recommended policy retains attendance, schedules, swaps, leave, tasks, acknowledgments, and audit history.
- **Application compatibility impact:** DELETE UI/API must become lifecycle commands with clear state-specific behavior.
- **Rollback implications:** Keep restrictive behavior. Repair application routing forward rather than restoring deletion.
- **Blocks 010–018:** **Yes: 017 and lifecycle command scope in 018.**
- **Stages affected:** 012, 017, 018.

### D13 — Foreign-key deletion behavior for workforce history

- **Exact issue requiring approval:** Approve replacing employee-directed cascades and classify retained operational pointers.
- **Recommended option:** `ON DELETE RESTRICT` for attendance, shifts, weekly/recurring schedules, time off, both shift-swap employee references, announcement acknowledgments, tasks, profile links, and new employment history. Keep `SET NULL` only for current operational pointers where history is not erased: department manager, maintenance assignee, and filled open-shift pointer. Never cascade historical facts.
- **Alternative options:** Retained immutable employee-reference snapshots in a future design; or `SET NULL` for selected nonhistorical pointers. Cascading factual history is unacceptable.
- **Security impact:** Prevents privileged deletion from erasing audit evidence.
- **Data-loss/history impact:** Critical and directly positive; preserves all historical records and joins.
- **Application compatibility impact:** Existing delete calls fail and must present lifecycle actions instead.
- **Rollback implications:** Do not restore cascades. Use forward application fixes if callers relied on deletion.
- **Blocks 010–018:** **Yes: 017; task/profile restrictive FKs in 015/016.**
- **Stages affected:** 015, 016, 017.

### D14 — Structural tenant-integrity rollout

- **Exact issue requiring approval:** Approve composite `(company_id,id)` parent keys, child composite FKs, validation order, lock windows, and inclusion of task assignee integrity without changing K8.
- **Recommended option:** Add supporting unique indexes first; add one bounded relationship group as `NOT VALID`; run zero-orphan/zero-mismatch checks; validate in a controlled low-traffic window. Include `(tasks.company_id, assigned_employee_id)` → employees as `ON DELETE RESTRICT` without changing the K8 RPC or event contract. Split 016 into approved ordered suffixes if lock testing warrants it.
- **Alternative options:** Validation triggers as an interim bridge; defer high-volume tables; or omit task FK temporarily while retaining K8 validation. Application/RLS-only enforcement is not a durable final option.
- **Security impact:** High. Prevents structurally cross-tenant employee relationships even if a caller or policy is defective.
- **Data-loss/history impact:** No valid row changes. Invalid data blocks deployment and requires separately approved remediation—never automatic deletion/reassignment.
- **Application compatibility impact:** Invalid legacy writes begin failing; valid K8 task creation remains unchanged.
- **Rollback implications:** Before validation, drop only the newly added unvalidated constraint if required. After validation, prefer forward correction; never weaken tenant isolation casually.
- **Blocks 010–018:** **Yes: 016, and therefore 017–018 by dependency.**
- **Stages affected:** 014, 015, 016, 017, 018.

### D15 — First K1–K8 employee command and convergence order

- **Exact issue requiring approval:** Select the first canonical employee mutation, its authorization/transition rules, and when human/API/AI callers converge on it.
- **Recommended option:** Implement `CreateEmployee` first as one focused vertical slice because current UI/API and Brain creation bypass full K1–K8 guarantees. Require owner/manager/super-admin authorization scoped to persisted company, validated canonical payload, command/version, durable idempotency, atomic employee plus safe outbox event, deterministic result, and Stage 0C confirmation for AI. Implement `ChangeEmployeeLifecycleStatus` next before removal of delete entry points. Route human/API first, then Brain after parity.
- **Alternative options:** Start with `ChangeEmployeeLifecycleStatus` to close delete sooner; or `LinkEmployeeProfile` after structural constraints. Implementing every command or a generic bus at once is not approved.
- **Security impact:** High. Removes client/model-selected authority and establishes canonical authorization/idempotency.
- **Data-loss/history impact:** Atomic mutation/outbox and safe lifecycle transitions improve history. Partial or duplicate mutations are prevented.
- **Application compatibility impact:** Existing create forms/API and legacy Brain `create_employee` need adapters and parity tests; public safe results should remain stable where practical.
- **Rollback implications:** During a short audited compatibility window, route callers back only if necessary while retaining receipts/outbox. Never replay failed mutations automatically.
- **Blocks 010–018:** **Yes: 018.**
- **Stages affected:** 018 directly; depends on 012, 013 where relevant, 015, and 017. Does not modify K8.

### D16 — Employee event content and delivery policy

- **Exact issue requiring approval:** Approve initial event type/version, safe payload, delivery guarantees, and operational handling of stuck employee outbox records.
- **Recommended option:** For the first command emit `employee.created` version 1 with employee UUID and non-sensitive lifecycle/organizational facts only. Exclude contact values, salary, notes, documents, role authority, and raw input. Use at-least-once delivery, logical uniqueness, idempotent identical redelivery, fail-closed conflicts, and an operational stuck-pending signal without automatic mutation replay.
- **Alternative options:** Record only a stable safe result reference; or delay external delivery while retaining the durable outbox obligation. Sensitive event payloads are unacceptable.
- **Security impact:** Prevents durable PII/compensation leakage into broad event infrastructure.
- **Data-loss/history impact:** Preserves a durable audit obligation without duplicating mutation.
- **Application compatibility impact:** Consumers must accept versioned safe facts; no consumer is required in D1.2D.
- **Rollback implications:** Leave pending obligations intact and disable delivery. Never delete events or rerun employee creation.
- **Blocks 010–018:** **Yes: 018.**
- **Stages affected:** 018.

### D17 — Reserved legacy contraction timing

- **Exact issue requiring approval:** Decide when migration `202607210019_d1_employee_legacy_contract.sql` may revoke broad base-row reads, stop legacy writes, and remove or null legacy sensitive/overloaded columns.
- **Recommended option:** Do not create/apply 019 until all production readers/writers are inventoried, server projections and canonical commands are live, reconciliation is clean, sensitive access tests pass, Brain Score is migrated, rollback has been rehearsed, and telemetry shows zero legacy use for at least two normal release cycles and one complete hospitality operating cycle agreed by operations. Require separate destructive approval and verified PITR.
- **Alternative options:** Revoke broad grants before dropping columns as two independently reviewed contraction migrations; retain encrypted legacy columns longer; or postpone contraction indefinitely while keeping them inaccessible. Immediate combined revoke/drop is not recommended.
- **Security impact:** Delaying grants revocation prolongs exposure; contracting too early can trigger emergency broad-access rollback. Prefer early read revocation after parity, later physical removal.
- **Data-loss/history impact:** Column removal is destructive. Retain verified canonical copies and backups; never remove legacy evidence needed for unresolved mappings.
- **Application compatibility impact:** Highest compatibility risk. Every UI, API, Brain tool, report, export, and Brain Score reader must be proven migrated.
- **Rollback implications:** Before column removal, route rollback is possible without reopening sensitive storage. After removal, recovery requires a separately approved forward restore from verified canonical data/PITR—not ad hoc re-creation.
- **Blocks 010–018:** **No.** It blocks only reserved migration 019 and final declaration of full privacy/legacy contraction.
- **Stages affected:** 013/014/018 readiness evidence; 019 execution.

## 3. Recommended approval set

For the safest production sequence, approve in this order:

1. D1 and D2: close anonymous access and establish the catalog baseline.
2. D7–D10: approve vocabularies and reviewed mapping rules before canonical backfill.
3. D3–D6: approve privacy and sensitive-data semantics before copying/cutting over data.
4. D11: approve optional one-to-one UUID linking and operator controls.
5. D12–D14: approve no-hard-delete, restrictive historical FKs, and staged tenant constraints.
6. D15–D16: approve the single `CreateEmployee` K1–K8 pilot and safe event contract.
7. D17 only after production parity and non-use evidence; keep migration 019 separately approved.

## 4. D1.2D completion boundary

This register records recommendations only. It creates no migration, executes no SQL, changes no database or application code, and does not begin D1.3 or K9.
