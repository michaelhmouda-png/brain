# Brain OS Engineering Standards

## Status and normative language

This document defines mandatory day-to-day engineering standards for Brain. It applies equally to human engineers, reviewers, Copilot, Codex, and future AI coding agents.

The words **must**, **must not**, **required**, and **prohibited** are normative. **Should** identifies the expected default; deviation requires a concrete reason in the implementation plan or review. Examples illustrate acceptable patterns but do not limit the rule.

These standards govern new work immediately. Existing violations are transitional debt, not precedent. They must be contained and migrated incrementally according to risk and the approved transition order.

## 1. Purpose

These standards translate [BRAIN_OS_VISION.md](./BRAIN_OS_VISION.md) and [BRAIN_OS_ARCHITECTURE_MANIFESTO.md](./BRAIN_OS_ARCHITECTURE_MANIFESTO.md) into daily engineering rules.

Every change must move Brain toward becoming a governed, connected, event-driven AI Operating System for Hospitality. A locally working feature is insufficient if it creates a new silo, duplicates business behavior, weakens tenant isolation, bypasses governance, or prevents future automation.

The standards are designed to preserve current working behavior while establishing safe seams for progressive migration. They do not authorize a repository-wide rewrite.

## 2. Instruction Priority

The order of authority is:

1. `BRAIN_OS_VISION.md`
2. `BRAIN_OS_ARCHITECTURE_MANIFESTO.md`
3. `BRAIN_OS_ENGINEERING_STANDARDS.md`
4. Approved architectural decision records
5. Approved implementation plans
6. Individual tickets or prompts

A lower-level instruction must not violate a higher-level document. If instructions conflict, stop the conflicting portion, identify the exact conflict, and request a decision at the appropriate authority level. Silence, urgency, an existing violation, or a previously implemented shortcut does not override this order.

Security, tenant isolation, auditability, and required approval for high-impact actions cannot be waived through an ordinary ticket or prompt.

## 3. Required Pre-Work

Before significant implementation, the engineer or AI agent must:

1. Read the Vision.
2. Read the Architecture Manifesto.
3. Read these Engineering Standards.
4. Inspect the affected bounded context and its current entry points, data ownership, dependencies, and tests.
5. Identify current externally visible behavior that must be preserved.
6. Identify actor, authorization, tenant, property, and sensitive-data implications.
7. Identify command, query, transaction, event, audit, idempotency, and observability implications.
8. Determine whether UI, API, AI, automation, and integration callers share the same business path.
9. Identify schema and migration implications.
10. Produce a concise implementation and verification plan.
11. Limit the work to the approved scope and avoid unrelated modification.

For a small, isolated change, this analysis may be brief. For a security, data, AI mutation, multi-tenant, migration, or cross-domain change, it must be explicit and reviewable.

## 4. Incremental Change Policy

Brain must evolve incrementally.

- Preserve working behavior unless a behavior change is explicitly approved.
- Prefer small changes that can be reviewed, tested, deployed, observed, and reversed independently.
- Avoid broad rewrites and repository-wide reorganizations.
- Establish interfaces and characterization tests before moving behavior.
- Migrate one command path, domain operation, or AI tool family at a time.
- Keep stable public interfaces when doing so does not preserve an unsafe contract.
- Separate structural refactoring from behavior changes where practical.
- Use adapters to contain legacy behavior during migration.
- Never perform opportunistic unrelated cleanup inside a focused task.

A migration is complete only when all intended callers use the canonical path and the legacy path is either removed or explicitly marked with an owner and removal condition.

## 5. Domain Organization

New canonical domain logic should increasingly follow this pattern:

```text
lib/domains/<domain>/
  application/
    commands/
    queries/
    handlers/
  domain/
    entities/
    value-objects/
    policies/
    events/
    errors/
  infrastructure/
    repositories/
    adapters/
  contracts/
  tests/
```

Using `src/domains` instead of `lib/domains` is permitted only through an approved repository convention. Do not create both conventions concurrently.

The intended layers are:

- **Domain:** business meaning, invariants, state transitions, policies, and facts.
- **Application:** use cases, commands, queries, orchestration, and transaction boundaries.
- **Infrastructure:** Supabase, external providers, persistence, transport, and vendor adapters.
- **Contracts:** stable typed boundaries exposed to callers.
- **Tests:** behavior organized with the owning domain.

Do not force an immediate repository-wide move. New canonical logic follows this structure; existing logic moves when its command path is intentionally migrated.

## 6. Business Logic Placement

Business rules belong in domain objects, policies, or application handlers.

They must not be independently implemented in:

- React components
- API route handlers
- AI tool handlers
- SQL deployment scripts
- Background workers
- Webhook handlers
- Device or provider adapters

Those layers may validate transport syntax, translate contracts, construct trusted context, call commands or queries, and format results. Database constraints and RLS reinforce domain rules but do not replace the canonical application behavior.

If a rule affects whether an action is valid, permitted, or complete, it must be reusable independently of the entry interface.

## 7. Human and AI Shared Path

Every operation available to both a person and Brain must use the same command, handler, policy, repository, event, and audit path.

```text
UI / API / AI tool / Worker / Integration
                  |
          typed command or query
                  |
        application handler + policy
                  |
       repository + transaction + event
```

AI tools must be thin adapters over application commands and queries. Direct AI-to-database mutation is prohibited. A prompt may guide tool selection; it cannot define or enforce the business rule.

No caller may receive special mutation behavior merely because it originated from AI. Origin must be recorded for audit and evaluation, while domain semantics remain identical.

## 8. Commands

Every meaningful mutation should use a typed command containing:

- Command name
- Command version
- Trusted `ActorContext`
- Tenant and relevant property/location scope
- Correlation ID
- Causation ID where relevant
- Durable idempotency key where retries or duplicate delivery are possible
- Typed payload
- Origin and audit metadata

Commands use imperative business language:

- `CreateTask`
- `AssignTask`
- `CompleteTask`
- `StartShift`
- `ReportIncident`
- `ReceiveDelivery`

Prohibited names describe persistence rather than intent:

- `InsertTaskRow`
- `UpdateTable`
- `SaveData`
- `PatchRecord`

One command represents one business intent. It owns its validation, policy decision, transaction boundary, audit behavior, and emitted facts. A command must return a typed result rather than a raw database record.

## 9. Queries

Queries must:

- Be typed and free of hidden mutations.
- Require verified tenant and relevant resource scope.
- Enforce authorization and data classification.
- Return stable response models rather than raw database shapes.
- Use deterministic ordering.
- Support bounded pagination for lists that can grow.
- Make partial, stale, or unavailable data explicit where relevant.

Use business names such as `GetTask`, `ListOpenTasks`, `GetShiftCoverage`, and `GetInventoryPosition`.

Queries must not broaden scope when tenant context is missing. Missing required scope is a typed error.

## 10. Domain Events

Events describe facts that have already happened. Use past-tense names such as:

- `TaskCreated`
- `TaskAssigned`
- `ShiftStarted`
- `InventoryBelowThreshold`
- `SupplierArrived`

Every event envelope must include:

- Event ID
- Event type
- Event version
- Tenant and relevant property/location scope
- Aggregate or entity type and ID
- Actor summary
- Occurrence timestamp
- Correlation ID
- Causation ID
- Typed payload
- Schema version

The distinctions are mandatory:

- **Observation:** something was detected or measured; it may be uncertain.
- **Command:** an authorized request to perform business intent.
- **Event:** an immutable fact that occurred.

Do not name an instruction as an event. `CreateTask` is a command; `TaskCreated` is an event.

## 11. Event Delivery

Durable cross-domain effects require a transactional outbox.

- The state mutation and outbox record must commit together.
- Consumers must be idempotent.
- Retries must be bounded and observable.
- Poison messages require dead-letter handling.
- Replay must be possible and permission-controlled.
- Consumers must assume at-least-once delivery, not exactly-once delivery.
- Delivery attempts and terminal outcomes must be auditable.

Until the outbox exists, new best-effort event behavior must be labeled `TRANSITIONAL_BEST_EFFORT`, documented with its failure consequence, and excluded from claims of reliable delivery. It must not carry a required audit, financial, safety, or irreversible business effect.

## 12. Actor Context

Authorization entry boundaries must construct one centralized `ActorContext` containing:

- Actor ID
- Actor type: user, service, device, workflow, or system
- Verified user/service/device identity
- Company ID
- Property/location/department scope where relevant
- Role
- Capabilities
- Session or credential context
- Authentication method
- Correlation metadata
- Origin channel

The context must be created from trusted authentication and authorization sources. Routes and AI tools must not independently reconstruct it using different profile queries or accept it from an untrusted body.

Actor context may be narrowed downstream but never broadened without a separately authorized delegation decision.

## 13. Authorization

Authorization is explicit and layered:

1. Authenticate identity.
2. Validate active status and tenant scope.
3. Check required capability.
4. Apply resource-level policy.
5. Apply risk and approval policy.
6. Enforce RLS as defense in depth.

Prompt instructions and RLS alone are not a complete authorization model. Caller-supplied company IDs, property IDs, employee IDs, roles, capabilities, or approval data must be checked against `ActorContext` and the target resource.

Every command and sensitive query must declare its required capabilities. Policy denial must return a typed, auditable result without revealing unauthorized resource existence.

## 14. Multi-Tenant Safety

Every read, write, event, cache entry, job, log, metric, AI context retrieval, integration credential, and device observation must be tenant-scoped.

Required tests include:

- Cross-company denial
- Cross-property denial where applicable
- Cross-department denial where applicable
- Authorized super-admin behavior
- Service identity scope
- Device identity scope where applicable
- Missing or malformed tenant context

Never assign a user to an arbitrary or first-available company automatically. Tenant membership and privileged roles require explicit, authorized provisioning.

Global aggregation must use an explicit capability and a separately reviewed query path; it must not weaken ordinary tenant isolation.

## 15. AI Tool Standards

Every AI tool must declare:

- Stable tool name and version
- Typed runtime input schema
- Typed output schema
- Risk classification
- Autonomy level
- Required capabilities
- Idempotency behavior
- Approval requirement
- Maximum execution time
- Audit behavior
- Safe error contract
- Evaluation fixtures
- Owning domain and command/query

AI tools must not:

- Trust client-returned executable arguments.
- Trust prompt text as authorization.
- Mutate a database directly.
- Hide destructive or consequential effects.
- Execute unbounded loops.
- Return raw internal errors.
- Log full sensitive payloads.
- Invent tenant, entity, or location identifiers.
- silently fall back to a broader scope.

Tool schema changes require compatibility review. A breaking tool change requires a new version or a controlled migration with evaluation evidence.

## 16. AI Planning and Execution

AI planning and execution must have:

- A bounded maximum number of tool steps
- Wall-clock time limits
- Cost or token budgets
- Explicit success and stop conditions
- Structured execution traces
- Model-independent tool fixtures
- Outcome verification for important actions
- Graceful failure and reduced-capability behavior
- Cancellation behavior for durable workflows

A plan that survives an HTTP request must be persisted as a governed workflow or proposal. Process memory, browser state, and model conversation state are not durable workflow storage.

The system must distinguish model output, validated plan, authorized command, execution result, and verified outcome.

## 17. Approval Standards

High-impact actions require durable server-side proposals containing:

- Proposal ID
- Requesting actor and origin
- Tenant and resource scope
- Action type and command version
- Canonical server-validated arguments
- Operation hash
- Risk level
- Required approver capability
- Expiry
- Status
- Created timestamp
- Approver identity and approval timestamp
- Execution idempotency key
- Execution result and verification state

The client receives an opaque proposal ID, display-safe summary, and expiry. It must not be treated as the source of executable arguments.

Approval must be bound to the exact operation hash. Editing a proposal creates a new proposal or new version requiring approval. Expired, cancelled, rejected, already-executed, cross-tenant, or insufficiently approved proposals must fail safely.

## 18. Data Validation

All external inputs require runtime validation:

- API bodies and headers
- Query and path parameters
- AI tool inputs
- Webhook payloads
- Worker and event messages
- Device observations
- Integration responses
- Environment configuration
- Imported files

TypeScript types do not validate runtime data. Validators must reject unknown or dangerous fields when appropriate, normalize only documented forms, enforce bounds, and return typed validation errors.

Validation occurs at trust boundaries. Domain invariants are still enforced inside the domain/application layer.

## 19. Data Contracts

Public application contracts must not expose database schemas directly. Define explicit:

- Request DTOs
- Response DTOs
- Command payloads
- Query result models
- Event schemas
- AI tool schemas
- Typed errors

Contracts must specify optionality, units, time semantics, identifiers, privacy classification, and compatibility rules. Breaking changes require versioning and a migration plan.

Generated database types may be used inside infrastructure adapters. They must not become the public domain API or leak Supabase-specific concepts into callers.

## 20. Error Handling

Use a typed error model with, at minimum:

- `ValidationError`
- `AuthenticationError`
- `AuthorizationError`
- `NotFoundError`
- `ConflictError`
- `PolicyViolationError`
- `ApprovalRequiredError`
- `DependencyError`
- `RateLimitError`
- `InternalError`

Rules:

- Do not swallow failures and return `false`, `null`, or an empty array unless that value is the valid, documented domain result.
- Do not expose Supabase, SQL, provider, stack-trace, policy-internal, or credential details to clients.
- Log internal diagnostic context securely.
- Return a stable code, safe message, correlation ID, and retryability where appropriate.
- Preserve the original failure category when translating between layers.

An infrastructure failure must never be represented as “no records found.”

## 21. Idempotency

Mutating commands that may be retried or duplicated require durable idempotency. This includes:

- AI-confirmed actions
- Payment-adjacent actions
- Supplier orders and commitments
- Shift operations
- Delivery processing
- Event consumers
- Integration webhooks
- Device ingestion with duplicate delivery
- Background jobs with retry

The idempotency record must be tenant-scoped and bind the key to command type, canonical payload hash, actor or trusted origin, status, result, and retention period. Reusing a key with a different payload is a conflict.

In-memory sets, process locks, and browser flags are not acceptable for distributed or restart-safe idempotency.

## 22. Transactions

Use transactions when one business action requires multiple writes to remain consistent, including:

- Primary mutation plus audit record
- Inventory movement plus quantity change
- Approval execution plus proposal status
- Command result plus outbox event
- Financial fact plus reconciliation state

Do not report success if a required audit, policy, quantity, proposal, or outbox write was lost. Side effects that cannot participate in the database transaction must start from the committed outbox and expose their own delivery state.

Transaction boundaries belong to application handlers, not UI components or provider adapters.

## 23. Repository Standards

Repository interfaces represent domain needs:

- `taskRepository.findOpenByAssignee()`
- `taskRepository.saveTransition()`
- `inventoryRepository.recordMovement()`
- `shiftRepository.findCoverageGap()`

Avoid generic persistence abstractions such as:

- `genericTableRepository.update()`
- `saveData()`
- arbitrary table-name methods

Infrastructure adapters may use Supabase. Domain and application code must not depend on Supabase query builders, PostgREST errors, or raw table shapes.

Repositories must require scope explicitly or be created from a trusted scoped context. They must not silently perform unscoped queries.

## 24. API Standards

API routes are thin adapters. They must:

1. Authenticate the request.
2. Construct `ActorContext`.
3. Validate transport input.
4. Invoke one or more explicit commands or queries.
5. Map typed results to stable response contracts.
6. Preserve or create a correlation ID.
7. Set appropriate security, caching, and retry headers.

They must not contain substantial business rules or direct domain-table mutations.

Standard success envelope:

```json
{
  "data": {},
  "meta": { "correlationId": "..." }
}
```

Standard error envelope:

```json
{
  "error": {
    "code": "AUTHORIZATION_DENIED",
    "message": "You are not permitted to perform this action.",
    "correlationId": "...",
    "retryable": false
  }
}
```

Paginated responses must include stable cursor or page metadata and deterministic ordering. Do not return raw provider responses.

## 25. React and UI Standards

UI components should:

- Render state and collect input.
- Call stable APIs or server actions.
- Display loading, empty, validation, approval, success, and safe error states.
- Preserve correlation IDs in support-visible errors where appropriate.
- Keep business invariants out of components.
- Avoid direct privileged database access.
- Avoid fake production-looking data.

Demonstration data must be labeled clearly as demonstration data and isolated from production views. Synthetic analytics, camera status, guest information, inventory levels, tasks, or financial metrics must never be presented as live facts.

Destructive UI actions must explain consequence and use the same governed approval path required by the command risk level.

## 26. Database and Migration Standards

The database requires:

- One canonical ordered migration history
- No competing schema snapshots treated as current truth
- Forward-only production migrations
- Data-preserving changes by default
- Explicit recovery or rollback strategy where appropriate
- Consistent table, column, constraint, and policy naming
- `timestamptz` for real-world instants unless a reason is documented
- Generated database types
- Migration verification in CI
- RLS review and tests for every tenant-owned table
- Index and query-impact review for growing tables

Do not edit an already applied production migration to rewrite history. Correct it with a new migration.

Migration files must state prerequisites, data transformation, locking or availability risk, verification, and recovery. Service-role execution must occur through controlled deployment paths, not user-triggerable application endpoints.

## 27. Naming Standards

Use one consistent business vocabulary.

- **Files/directories:** lowercase kebab-case unless framework conventions require otherwise.
- **Types/entities/value objects:** PascalCase singular nouns, such as `Task` and `InventoryPosition`.
- **Commands:** PascalCase imperative intent, such as `CompleteTask`.
- **Queries:** PascalCase `Get` or `List` names, such as `ListOpenTasks`.
- **Events:** PascalCase past tense, such as `TaskCompleted`.
- **Handlers:** `<CommandName>Handler` or `<QueryName>Handler`.
- **Repositories:** `<Aggregate>Repository` with domain-specific methods.
- **Policies:** business rule plus `Policy`, such as `MayApproveShiftPolicy`.
- **API endpoints:** plural resource nouns or explicit action endpoints where a resource representation is insufficient.
- **Database:** snake_case plural table names and snake_case columns.

Do not use two names for one concept, such as `incidents` and `incident_reports`, unless a documented domain distinction exists. Do not reuse one name for different concepts.

## 28. Time and Localization

Never rely implicitly on server-local time for business meaning.

- Store authoritative instants in UTC.
- Preserve the property time zone that gives an instant business meaning.
- Resolve terms such as “today,” “tomorrow,” and shift dates in the relevant property time zone.
- Make daylight-saving gaps and overlaps explicit.
- Keep pure calendar dates distinct from instants.
- Localize text, numbers, currency, and dates at presentation boundaries.
- Include time zone and daylight-saving cases in scheduling and deadline tests.

Commands involving operational dates must carry the relevant scope or time zone. The model, browser, or server default time zone must not decide silently.

## 29. Logging

Use structured logs. Important entries should include, where relevant:

- Timestamp
- Severity
- Service or module
- Correlation ID
- Actor ID or pseudonymous reference
- Tenant ID
- Command, query, event, tool, or workflow type
- Outcome
- Duration
- Safe error code

Do not log:

- Passwords, tokens, secrets, cookies, or authorization headers
- Full message content by default
- Full AI tool arguments when sensitive
- Guest or employee personal data without necessity
- Payroll or payment details without approved controls
- Raw camera evidence by default

Logs must be useful without becoming an alternate sensitive-data store. Redaction must happen before serialization.

## 30. Observability

Important commands, queries, AI interactions, events, workers, workflows, and integrations must expose, where relevant:

- Latency and throughput
- Success/failure and error category
- Retry count and terminal state
- Queue delay
- Tool calls and step count
- Model/provider/version usage
- Token and monetary cost
- Approval latency
- Verified outcome
- Confidence and data freshness

Service-level objectives should be defined for critical capabilities. Alerts must be actionable and linked to runbooks. A feature without operational visibility is not production-complete.

Observability must preserve tenant and privacy boundaries; global metrics must not expose tenant content.

## 31. Security Standards

Required controls include:

- Least privilege for users, services, workers, devices, and integrations
- Managed secrets and rotation
- Production guards for debug and administrative endpoints
- No service-role credentials in public or user-triggerable paths
- Secure defaults and deny-by-default policy behavior
- Dependency and supply-chain review
- Rate limiting and abuse controls where necessary
- Runtime input validation and output encoding
- CSRF analysis for cookie-authenticated mutations
- Audit for sensitive reads and writes
- Secure device enrollment and identity for edge systems
- Separate operational control planes for deployment and schema administration

Debug behavior must fail closed in production. Security-relevant configuration must be validated at startup or deployment, not discovered through a user request.

## 32. Privacy Standards

Guest, employee, camera, biometric, location, and device data require:

- Declared purpose
- Data minimization
- Privacy classification
- Retention and deletion policy
- Access restrictions
- Consent or notice where required
- Privacy zones and masking where relevant
- Evidence access logging
- Deletion, anonymization, and export workflows where applicable
- Preference for structured observations over unnecessary raw footage

New sensitive data collection requires privacy review before implementation. Data useful “in the future” is not a sufficient collection purpose.

AI prompts, model providers, logs, evaluation datasets, and support tools are all data-processing boundaries and must obey the same policy.

## 33. Testing Standards

Required categories, according to feature risk, include:

- Unit tests
- Domain invariant and state-transition tests
- Command-handler tests
- Policy and authorization tests
- Tenant-isolation tests
- RLS tests
- API-contract tests
- AI-tool schema, policy, idempotency, and outcome tests
- Event producer and consumer tests
- Integration tests
- End-to-end tests
- Migration and data-preservation tests
- Hardware and provider simulations
- Failure, timeout, retry, replay, and idempotency tests

Every bug fix should add a regression test when practical. Tests must import and exercise production code; copying production logic into a test is prohibited because it can reproduce the same defect without testing the real implementation.

Tests must be deterministic by default. Model, clock, UUID, provider, and device dependencies require controllable substitutes.

## 34. Test Priority

During the current transition, implement tests in this order:

1. Critical security and tenant-boundary tests
2. Current-behavior characterization tests
3. Task command and API tests
4. AI task-tool tests
5. Approval and durable-idempotency tests
6. Event/outbox tests
7. Remaining domain migration tests

This order does not permit new high-risk functionality to ship without its own tests. It prioritizes remediation of the existing repository.

## 35. Brain Score Standards

Brain Score calculations must be:

- Deterministic
- Formula-versioned
- Explainable
- Reproducible
- Tenant- and property-scoped
- Based on traceable source metrics and time windows
- Honest about missing data, confidence, freshness, and uncertainty
- Persisted where historical comparison matters

Each score result must expose component values, weights, source lineage, formula version, calculated time, and missing-data treatment. Formula changes must not silently rewrite historical meaning.

Missing data must not automatically produce a perfect score. It should reduce confidence, produce an explicit unknown state, or follow a documented neutral-data policy.

## 36. Perception and Hardware Standards

Perception systems produce normalized observations. Hardware adapters must never directly mutate operational domains.

Required concepts include:

- Device identity
- Device capabilities
- Observation type and version
- Source and ingestion timestamps
- Location or digital-twin zone
- Confidence and quality
- Evidence reference
- Health state
- Provider metadata
- Privacy classification

An observation may lead to a policy evaluation, recommendation, proposal, or command; it is not itself authority to perform consequential action.

Build simulators and recorded fixtures before relying on physical hardware. Test duplicate delivery, disconnection, stale clocks, corrupted observations, low confidence, and provider replacement.

## 37. Integration Standards

Every external integration uses:

- A provider-neutral port
- A provider-specific adapter
- Typed, versioned contracts
- Health checks
- Timeouts and circuit behavior
- Bounded retries
- Rate-limit handling
- Idempotency
- Reconciliation against the source of truth
- Observability
- Secure credential storage and rotation

POS, PMS, camera, access-control, IoT, and AI-provider concepts must not leak into core domain models unless they represent genuine hospitality concepts.

Integration success means both transport acceptance and reconciled business outcome. Webhook receipt alone is not completion.

## 38. Documentation Standards

Every significant domain or platform capability must document:

- Responsibility and bounded-context ownership
- Public contracts
- Commands and queries
- Events and consumers
- Policies and capabilities
- Data ownership and classification
- Failure and degraded modes
- Operational dependencies
- Observability and runbook links
- Testing approach
- Migration and compatibility notes

Documentation changes must accompany behavior and contract changes. Completion reports are not substitutes for current reference documentation.

Examples and diagrams must match production contracts or be labeled conceptual.

## 39. Architectural Decision Records

Create ADRs for significant decisions including:

- New infrastructure or deployment units
- New bounded contexts
- Provider selection
- Breaking contract changes
- Event semantics
- Security or privacy tradeoffs
- Data ownership changes
- Approved Manifesto exceptions

Each ADR includes:

- Context
- Decision
- Considered alternatives
- Consequences and risks
- Migration impact
- Compatibility impact
- Review date where relevant

ADRs record decisions; they do not override higher-authority documents.

## 40. Architectural Exceptions

A temporary violation of the Manifesto or these standards must be:

- Explicit
- Documented
- Approved at the correct authority level
- Time-bound
- Assigned an owner
- Given a measurable removal condition
- Contained so that new callers do not depend on it
- Observable where failure risk is material

The exception record must identify the violated rule, reason, risk, compensating controls, expiry, and migration path.

“Temporary” undocumented architecture is permanent technical debt. Tenant isolation, authorization, service-role exposure, and required high-impact approval cannot be accepted as ordinary temporary exceptions.

## 41. Pull Request Requirements

Every significant change must state:

- Problem and desired outcome
- Scope and excluded scope
- Affected bounded context
- Current behavior
- New behavior
- Authorization and capability impact
- Tenant/property impact
- Data and migration impact
- Transaction impact
- Event and audit impact
- AI/tool/approval impact
- Brain Score impact
- Privacy and security impact
- Risks and known limitations
- Tests and evidence
- Observability
- Rollback or recovery plan
- Documentation updated
- Any approved exception

AI-generated pull requests have the same requirements. Generation speed does not reduce review depth.

## 42. Code Review Checklist

Reviewers must verify:

- [ ] Alignment with the Vision
- [ ] Compliance with the Manifesto and these standards
- [ ] Correct bounded-context ownership
- [ ] Shared human/AI application path
- [ ] Tenant and property safety
- [ ] Explicit capabilities and resource policy
- [ ] Runtime validation
- [ ] Stable contracts and typed errors
- [ ] Event and audit behavior
- [ ] Durable idempotency where needed
- [ ] Correct transaction boundaries
- [ ] Failure and retry behavior
- [ ] Tests exercise production code
- [ ] Observability and safe logging
- [ ] Privacy and data minimization
- [ ] No unrelated changes
- [ ] No hidden provider lock-in
- [ ] No synthetic data presented as real
- [ ] Documentation and migration notes are current

A reviewer must block a change with an unresolved critical or high-severity tenant, authorization, approval, privacy, or data-integrity risk.

## 43. Definition of Done

A feature is complete only when all relevant requirements are satisfied:

- Business logic is in the owning domain/application layer.
- Human and AI paths are unified.
- Authorization and high-risk policy are explicit.
- Tenant isolation is tested.
- External inputs are validated at runtime.
- Contracts and errors are typed.
- Required audit records are committed.
- Events are emitted reliably where required.
- Durable idempotency exists where needed.
- Transaction boundaries preserve business consistency.
- Relevant tests pass and exercise production code.
- Logs, metrics, traces, and alerts exist in proportion to risk.
- Documentation and contracts are updated.
- Brain Score and automation implications are considered.
- Privacy, retention, and security are reviewed.
- Deployment, rollback, and recovery are understood.
- No known critical or high-severity issue is introduced.

If an item is not applicable, the implementation or review must say why. An unexamined item is not equivalent to a non-applicable item.

## 44. Prohibited Patterns

The following are explicitly prohibited in new canonical work:

- Direct AI-to-database mutation
- Trusting client-returned approval arguments
- Automatic tenant assignment
- Automatic privileged-role creation
- Business logic inside route handlers or UI components
- Duplicated UI, API, worker, integration, and AI business logic
- Unbounded AI tool loops
- In-memory-only idempotency for durable actions
- Swallowing important failures
- Returning raw database or provider errors to clients
- Treating competing schema files as simultaneous current truth
- Hard-coded production provider dependencies in domain logic
- Presenting synthetic analytics or operational data as real
- Exposing debug endpoints in production
- Service-role access from untrusted request paths
- Cross-tenant queries without explicit verified scope
- Missing tenant scope interpreted as global access
- Required audit or event writes performed as ignorable best effort
- Tests that duplicate rather than import production logic
- Silent fallback to a different tenant, property, entity, model behavior, or authorization scope

Existing instances must be recorded and migrated; they must not be copied as patterns.

## 45. Current Transition Priorities

Based on the Phase 1 audit and Phase 2 gap analysis, the immediate order is:

1. Contain critical security and tenant risks.
2. Add characterization and tenant-boundary tests.
3. Introduce the shared architecture kernel.
4. Make Tasks the first canonical domain.
5. Add centralized policy and durable approvals.
6. Decompose the Brain chat route incrementally.
7. Migrate remaining operational domains one command path at a time.
8. Add a transactional outbox and background workers.
9. Consolidate database migrations and generate types.
10. Build Brain Score v2.
11. Expand hospitality domains through canonical contracts.
12. Add perception, edge, and proactive intelligence after command/event foundations are stable.

Do not skip directly to hardware, autonomous workflows, or broad hospitality integrations while critical tenant, approval, and shared-business-path violations remain unresolved.

## 46. Final Engineering Rule

“Do not optimize for making the next screen work. Optimize for making every capability a safe, reusable, connected part of the Brain Operating System.”
