# Brain OS Architecture Manifesto

## Status and purpose

This document defines the permanent architectural direction for Brain. It is a decision framework for engineers, architects, product teams, integration partners, and AI coding agents. It applies to every future module, fix, refactor, integration, data model, hardware capability, and AI feature.

Brain's destination is a complete AI Operating System for Hospitality. It is not a collection of unrelated management screens, loosely connected tools, or an AI chat feature placed beside conventional software. Every change must strengthen one connected operational system.

These principles describe the target architecture. They do not require an immediate rewrite. The current modular monolith should evolve incrementally, preserving working behavior while replacing architectural inconsistencies through explicit boundaries and contracts.

## 1. Product Mission

Brain is the central operating system through which a hospitality business observes its operations, coordinates people and systems, makes governed decisions, executes work, and learns from outcomes.

Brain must eventually connect and coordinate:

- Companies, brands, properties, and venues.
- Locations, departments, rooms, zones, and service areas.
- Employees, contractors, workforce capabilities, and organizational responsibilities.
- Shifts, attendance, payroll inputs, labor planning, and performance.
- Tasks, checklists, standards, escalations, and operational workflows.
- Maintenance, equipment, facilities, and physical assets.
- Safety, food safety, security, incidents, and compliance.
- Inventory, purchasing, suppliers, deliveries, stock movement, and waste.
- Guests, reservations, CRM, preferences, complaints, and service recovery.
- POS data, revenue, costs, profitability, budgets, and forecasting.
- Communications, announcements, training, knowledge, and notifications.
- Cameras, access control, sensors, IoT gateways, and smart equipment.
- AI observations, recommendations, approvals, and autonomous actions.
- Brain Score and the explainable operational health of the business.

Brain must maintain a coherent view of these concerns and their relationships. A module is valuable not only for what it does locally, but for the operational context it contributes to the whole system.

## 2. Core Operating Loop

Every intelligent capability must implement or support this loop:

**Observe -> Understand -> Decide -> Act -> Verify -> Learn**

### Observe

Receive facts and signals from people, software, databases, integrations, cameras, sensors, schedules, transactions, and equipment. Preserve source, time, tenant, property, confidence, and provenance. An observation is not automatically treated as truth or as permission to act.

### Understand

Normalize signals into shared concepts, resolve entities and locations, correlate related events, establish context, assess confidence, and determine operational significance. Understanding must distinguish facts, estimates, predictions, and assumptions.

### Decide

Evaluate rules, policies, risk, permissions, priorities, dependencies, historical context, and available options. Decisions may be deterministic, human-made, AI-assisted, or automated, but their rationale and authority must be recorded.

### Act

Execute a governed domain command, initiate a workflow, notify a person, control an approved integration, or prepare an action for approval. Every mutation must have an actor, tenant scope, reason, correlation identifier, and idempotency strategy.

### Verify

Measure whether the intended outcome occurred. Verification may use user confirmation, system state, downstream acknowledgements, sensor observations, elapsed-time checks, or business metrics. Command acceptance alone is not proof of success.

### Learn

Compare intent with outcome, update operational metrics, improve recommendations and forecasts, detect recurring failure modes, and feed explainable changes into Brain Score. Learning must be governed, evaluated, and reversible; production behavior must not silently change because an opaque model adapted itself.

## 3. One Connected Operating System

Modules must not become isolated applications. Every bounded context remains independently understandable, but communicates through typed commands, queries, events, policies, and shared organizational context.

Cross-domain consequences are first-class behavior:

- A late supplier delivery can affect available inventory, purchasing decisions, prep tasks, staffing needs, notifications, supplier performance, service readiness, and Brain Score.
- A camera detecting a long bar queue can emit an operational observation, trigger a queue event, recommend staff movement, alert a manager, open a task, and later measure whether service speed improved.
- A fridge temperature anomaly can create a maintenance task, raise a food-safety risk, estimate exposed inventory, notify responsible employees, preserve evidence, and update Brain Score.

Domains must not reach into one another's tables to create these effects. The owning domain exposes commands and queries and publishes events. Consumers respond through their own application services.

Shared organizational context must consistently identify the tenant, brand, property, location, department, actor, time zone, language, and relevant capability scope.

## 4. Human and AI Actions Use the Same Business Logic

UI actions, public and internal API actions, scheduled automation, integration callbacks, hardware observations, background jobs, and AI tools must invoke the same domain commands and application services.

An interface may translate input, collect approval, or format output. It must not implement a separate version of validation, authorization, or mutation logic. In particular, the AI chat endpoint must never contain an alternative implementation of business operations.

For example, creating a task must have one application command regardless of whether the request originated from a manager clicking a button, an AI recommendation accepted in chat, a scheduled checklist, a camera observation, or a third-party integration. Each channel supplies an actor and origin, while the command handler enforces the same invariants and emits the same events.

## 5. Domain Boundaries

The following bounded contexts define ownership. Boundaries may share identifiers and contracts, but not internal models or database implementation details.

### Identity and Tenancy

Owns users, service identities, sessions, tenant membership, roles, capabilities, impersonation controls, and the authenticated actor context.

### Organization

Owns companies, brands, properties, venues, locations, departments, organizational hierarchy, operating calendars, and responsibility assignments.

### Workforce

Owns employee and contractor records, positions, skills, certifications, availability, employment state, training state, and performance inputs.

### Operations and Tasks

Owns tasks, checklists, standard operating procedures, priorities, dependencies, assignments, execution state, verification, and escalation.

### Scheduling and Attendance

Owns schedules, recurring shifts, attendance, clock events, time-off requests, shift swaps, staffing coverage, and governed payroll inputs.

### Maintenance and Assets

Owns physical assets, equipment, asset condition, preventive maintenance, maintenance tickets, work history, warranties, and service providers.

### Safety and Incidents

Owns hazards, incidents, food-safety events, security events, severity assessment, evidence, response procedures, investigations, and regulatory records.

### Inventory and Procurement

Owns catalog items, stock locations, quantities, movements, counts, par levels, purchase requirements, waste, and inventory valuation inputs.

### Suppliers and Deliveries

Owns suppliers, commercial relationships, orders, delivery appointments, arrivals, acceptance, discrepancies, quality, and reliability metrics.

### Guest Experience and CRM

Owns guest identity, preferences, interactions, feedback, complaints, loyalty context, sentiment, and service-recovery cases.

### Reservations and Service Flow

Owns reservations, covers, occupancy, tables or rooms, arrival and departure states, queues, seating or allocation, and service-stage progression.

### Finance and Performance

Owns normalized revenue and cost facts, budgets, profitability metrics, forecasts, labor-cost analysis, and management reporting. Source financial systems remain authoritative where required.

### Communications

Owns announcements, conversations, notifications, delivery preferences, acknowledgement, training communications, and channel delivery state.

### Intelligence and AI

Owns model access, planning, reasoning support, recommendations, AI memory, tool registration, evaluation, confidence, and AI-specific observability. It does not own other domains' mutations.

### Perception

Owns ingestion and normalization of observations from cameras, sensors, access systems, and the physical environment. It converts vendor signals into governed, structured observations.

### Automation and Workflows

Owns durable multi-step processes, triggers, timers, approvals, retries, compensating actions, and workflow state across domains.

### Integrations

Owns external-system adapters, synchronization, mapping, credentials references, webhooks, rate-limit handling, reconciliation, and integration health.

### Audit, Compliance, and Governance

Owns immutable audit evidence, policy decisions, retention, consent, legal holds, data access records, compliance controls, and governance reporting.

## 6. Perception Layer

Perception is the boundary between the physical world and Brain's business domains. It must eventually support:

- Door, staff-entrance, supplier-entrance, fridge, storage, dining-room, bar, kitchen, crowd, and queue cameras.
- Temperature, humidity, door-open, weight, energy, smoke, gas, leak, and environmental sensors.
- RFID, NFC, QR, BLE, GPS, access-control, and presence events.

Perception emits normalized observations such as a count, threshold crossing, measurement, detected condition, movement, or device-health state. Each observation carries device identity, venue and zone, source time, ingestion time, confidence, model or firmware version, evidence reference when permitted, and privacy classification.

Hardware must not directly create tasks, discipline an employee, change a schedule, or mutate inventory. Policies and application services interpret observations and decide whether to emit domain commands or begin approval workflows.

## 7. Hardware Abstraction

Brain must never permanently depend on one camera, sensor, POS, PMS, access-control, IoT, or appliance vendor.

Provider adapters translate external protocols and vendor payloads into versioned Brain contracts. The core uses normalized device capabilities, health states, measurements, observations, and commands. Vendor-specific identifiers and features remain inside adapters or explicit extension fields.

Potential adapters include ONVIF, RTSP, Hikvision, Dahua, Axis, Hanwha, UniFi Protect, POS systems, PMS systems, access-control systems, IoT gateways, and smart appliances.

Every adapter must declare capabilities, authentication needs, delivery guarantees, clock behavior, offline behavior, rate limits, privacy characteristics, and supported command semantics. Replacement of a provider must not require rewriting a business domain.

## 8. Digital Twin

Brain must maintain a digital twin of each venue: a versioned model of physical and organizational reality linked to live operational state.

The twin should eventually represent properties, buildings, floors, rooms, zones, entrances, kitchens, bars, tables, fridges, equipment, cameras, sensors, employees, guests, suppliers, inventory locations, and current operational state.

Relationships are essential: a camera observes a zone; a fridge resides in a kitchen; an inventory lot is stored in the fridge; an employee is responsible for the kitchen; an incident affects the zone. Stable identifiers and effective-dated relationships allow events to be interpreted correctly even as layouts and responsibilities change.

The digital twin is not a single unrestricted database object. Each domain remains authoritative for its entities, while the twin provides a governed projection and relationship graph suitable for situational awareness.

## 9. Event-Driven Architecture

Domain events are the primary mechanism for communicating completed facts across domain boundaries. Representative events include:

- `EmployeeEnteredVenue`
- `EmployeeShiftStarted`
- `EmployeeShiftEnded`
- `SupplierArrived`
- `DeliveryStarted`
- `DeliveryCompleted`
- `InventoryBelowThreshold`
- `FridgeTemperatureExceeded`
- `QueueThresholdExceeded`
- `TaskCreated`
- `TaskEscalated`
- `IncidentReported`
- `MaintenanceIssueDetected`
- `GuestComplaintReceived`
- `BrainScoreChanged`

Events must be immutable, typed, versioned, tenant-scoped, time-stamped, attributable, and traceable by correlation and causation identifiers. Event names describe facts that have occurred, not instructions.

State changes and event publication must use a transactional outbox. Background workers deliver outbox records to consumers. Consumers must be idempotent, retries must use bounded backoff, poison messages must enter a dead-letter process, and operators must be able to inspect and replay events safely. Delivery, failure, replay, and consumer outcomes must be auditable.

Events provide decoupling; they do not remove ownership. Synchronous commands remain appropriate when an immediate authoritative result is required.

## 10. AI Architecture

AI is a governed platform capability composed of separate modules:

- **Model gateway:** provider-neutral model access, routing, fallback, budgets, retries, and usage accounting.
- **Tool registry:** versioned tool contracts mapped to authorized application commands and queries.
- **Intent and planning:** interprets goals, constructs plans, identifies missing information, and separates proposals from execution.
- **Context and memory:** retrieves relevant organizational, conversational, operational, and historical context with explicit scope and retention.
- **Policy and authorization:** determines which data and actions are permitted for the actor, tenant, venue, channel, and autonomy level.
- **Domain command execution:** invokes domain-owned application services and returns structured outcomes.
- **Approval workflows:** records proposals, approvers, expiry, changes, decisions, and final execution.
- **AI observability:** records models, prompts or prompt versions, tool calls, latency, token and monetary cost, confidence, policy decisions, and outcomes without leaking protected data.
- **Evaluation and learning:** measures quality and safety using repeatable datasets, production feedback, outcome metrics, and controlled releases.

The AI assistant is only one interface. Brain must also provide proactive intelligence driven by events, schedules, trends, anomalies, unresolved risks, and operational goals without waiting for a user message.

Models may propose and interpret; deterministic application services remain authoritative for business invariants and mutations.

## 11. Governed Autonomy

Every AI or automation capability must declare an autonomy level:

- **Level 0 — Observe only:** collect and summarize; no recommendation or mutation.
- **Level 1 — Recommend:** propose a course of action with evidence, confidence, and expected impact.
- **Level 2 — Prepare for approval:** construct a validated, previewable command or workflow that cannot execute until approved.
- **Level 3 — Execute low-risk approved automation:** run actions pre-authorized by an explicit policy, within bounded scope and limits.
- **Level 4 — Execute governed autonomous workflows:** coordinate multi-step actions under continuous policy enforcement, monitoring, stop conditions, and audit.

Autonomy is granted per capability and context, not globally. Policies must define scope, monetary or operational limits, confidence thresholds, approvers, expiry, rollback or compensation, and emergency stop behavior.

Payroll-related changes, disciplinary actions, payments, supplier commitments, guest compensation, safety actions, access-control changes, and schedule changes with material impact require human approval unless a formally adopted policy explicitly defines a legally and operationally safe exception. Irreversible or high-impact actions must never rely only on model confidence.

## 12. Brain Score

Brain Score is the central, explainable measure of operational health. It may combine task completion, staffing health, attendance, service speed, guest satisfaction, inventory accuracy, waste, maintenance, safety, cleanliness, supplier reliability, profitability, and AI observations.

The score is a governed metric, not an opaque model output. Every change must trace to source events, normalized metrics, weight and threshold versions, time windows, tenant/property scope, and confidence. Users must be able to inspect why a score changed, what is actionable, and whether data is missing or uncertain.

Scores must support drill-down by company, property, location, department, domain, and time. Historical values must remain reproducible when formulas change. Brain Score must not become an unreviewable mechanism for employee discipline or other consequential decisions.

## 13. Multi-Tenant and Multi-Property Design

Brain must support multiple companies, brands, properties, locations, departments, regional structures, and group-level views. It must support role-based and capability-based access, delegated administration, location-specific time zones, localization, and applicable data-isolation and residency requirements.

Tenant and property scope must be explicit in actor context, commands, queries, events, jobs, caches, logs, metrics, vector retrieval, AI context, and integration credentials. A missing tenant scope is an error, never a request for global data.

Group-level reporting must use authorized aggregation rather than weakening row-level isolation. Time must be stored as an unambiguous instant with the operating time zone preserved for schedules and business interpretation.

## 14. Security and Privacy

The architecture requires:

- Tenant isolation and row-level security as defense in depth.
- Centralized authorization and capability checks.
- Least-privilege credentials for people, services, devices, workers, and integrations.
- Immutable, attributable audit records for sensitive reads, decisions, approvals, and mutations.
- Encryption in transit and at rest, managed secrets, rotation, and credential isolation.
- Explicit retention, deletion, legal-hold, export, and data-residency policies.
- Consent, notice, lawful purpose, and jurisdiction-aware governance for camera, location, and biometric systems.
- Privacy zones, masking, purpose limitation, and restricted access to raw video.
- Preference for local edge processing and structured events instead of unnecessary continuous footage.

Service-role credentials must never become a convenience path around tenant policies. Debug and administrative capabilities must be disabled or separately protected in production.

## 15. Edge AI

Brain must support venue-local edge nodes for camera and sensor processing. Edge nodes may perform stream ingestion, object or condition detection, counting, measurement normalization, privacy masking, temporary buffering, device control, and local safety rules.

The cloud should primarily receive structured events, counts, measurements, alerts, confidence scores, selected evidence snapshots where lawful and permitted, and device-health information.

Edge processing provides:

- Lower latency for time-sensitive operations.
- Reduced bandwidth and cloud-processing cost.
- Continued local operation during network interruption.
- Better privacy through local filtering and reduced footage transfer.
- Controlled data residency for sensitive signals.

Edge nodes must use signed software, secure enrollment, device identity, encrypted communication, local retention limits, store-and-forward delivery, clock synchronization, remote health monitoring, and safe upgrade/rollback. Cloud and edge contracts must be version-compatible.

## 16. Reliability

All critical workflows require idempotency, bounded retries, dead-letter handling, offline tolerance where relevant, device heartbeat monitoring, graceful degradation, observability, backups, tested restoration, and disaster recovery.

External calls must have timeouts and circuit-breaking behavior. Background work must be resumable. Duplicate events must not duplicate business effects. Offline devices must report stale state rather than silently appearing healthy. Failure in AI must not prevent deterministic core operations from functioning.

Brain must not depend on a single AI provider. Provider outages, quota exhaustion, latency, policy changes, or model regressions must be handled through routing, fallback, reduced-capability modes, and deterministic alternatives where possible.

Recovery objectives must be classified by domain. Safety, access, attendance, payments, and audit evidence may require different availability and recovery guarantees than analytics or recommendations.

## 17. Data Contracts

Commands, queries, events, entities, device observations, AI tools, APIs, and errors must be typed and versioned.

Contracts must specify identity, tenant scope, actor, timestamps, validation rules, compatibility expectations, privacy classification, and error semantics where applicable. Schema evolution must be additive when possible and use explicit migration or translation when not.

Database schemas are private persistence details, not the direct public contract of the application. UI components, AI tools, and integrations must not depend on table shapes. Repositories and mappers protect the domain from Supabase, vendor, and migration concerns.

Errors must distinguish validation, authentication, authorization, conflict, not found, transient dependency failure, policy denial, approval required, and unexpected failure. Machine-readable codes are required; messages alone are not contracts.

## 18. Testing Requirements

Every domain must eventually include:

- Unit tests for pure logic.
- Domain tests for invariants and state transitions.
- Authorization and capability tests.
- Tenant-isolation and cross-tenant denial tests.
- Database row-level-security tests.
- API-contract and compatibility tests.
- AI-tool schema, authorization, idempotency, and outcome tests.
- Event production, consumption, ordering-assumption, and replay tests.
- Integration tests against controlled external-system substitutes.
- End-to-end tests for critical user and AI workflows.
- Hardware-adapter simulations and recorded-payload tests.
- Failure, timeout, retry, duplicate-delivery, offline, and recovery tests.

AI evaluation must include deterministic regression cases, adversarial authorization attempts, ambiguous entity resolution, hallucinated identifiers, prompt injection from external data, approval bypass attempts, and measurable task outcomes.

No critical architecture is complete if it cannot be tested without a live vendor, physical device, or nondeterministic model response.

## 19. Architectural Decision Filter

Every implementation proposal and material code review must answer:

1. Does this move Brain toward a complete Hospitality AI Operating System?
2. Does it integrate coherently with the rest of Brain?
3. Can humans and AI use the same business logic?
4. Can it emit and consume domain events where appropriate?
5. Is it safe for multiple tenants and properties?
6. Is every important decision and mutation auditable?
7. Is it hardware- and provider-neutral where relevant?
8. Can it scale without rewriting the entire system?
9. Does it support future governed automation?
10. Does it avoid creating a new architectural dead end?

An answer of "not yet" requires a recorded follow-up and an explicit containment boundary. An answer of "not applicable" requires a reason. Delivery pressure is not sufficient justification for bypassing tenant safety, authorization, audit, or irreversible-action controls.

## 20. Non-Negotiable Rules

- No isolated feature silos.
- No direct AI-to-database mutations outside governed domain commands.
- No duplicated business logic between UI, API, automation, integrations, and AI.
- No provider lock-in in the core domain.
- No unaudited mutations.
- No cross-tenant access.
- No high-impact autonomous action without policy and approval.
- No major feature without a relevant integration path into Brain Score, events, intelligence, and automation.
- No shortcut that blocks the final Brain OS architecture.
- No database table shape as a public application or AI-tool contract.
- No hardware observation treated as identity, intent, or guilt without appropriate verification.
- No silent AI behavior change in production without versioning, evaluation, and rollout control.

## 21. Current Project Transition

Brain currently operates as a Next.js and Supabase modular monolith. It has useful beginnings: authenticated dashboard routes, operational modules, service classes, AI entity and context helpers, activity and notification mechanisms, and schemas for several hospitality domains. The Phase 1 audit also identified inconsistent boundaries: pages and routes access Supabase directly, authorization is repeated, two shift services overlap, some UI/API contracts are missing or duplicated, SQL history is fragmented, and the Brain chat route combines AI orchestration, authorization, tools, business logic, and direct persistence in approximately 5,400 lines.

This can evolve without a complete rewrite. A modular monolith is an appropriate transition architecture if its internal boundaries become explicit.

### Ordered transition plan

1. **Preserve current working behavior.** Establish characterization tests and operational baselines before moving logic. Refactors must retain externally visible behavior unless a separately approved change says otherwise.
2. **Establish shared architecture contracts.** Define actor context, tenant scope, command/query envelopes, domain events, typed errors, idempotency, correlation, and audit metadata in a small versioned kernel.
3. **Decompose the large Brain chat route.** Extract the model gateway, tool registry, intent/planning, context, policy enforcement, command adapters, approvals, and observability behind stable interfaces. Move one tool family at a time.
4. **Centralize authorization and actor context.** Authenticate once at each entry boundary, construct a scoped actor, and enforce capability policies in application services as well as RLS.
5. **Introduce domain commands and queries.** Begin with high-use mutations such as tasks, employees, shifts, incidents, maintenance, and announcements. Put invariants and transaction boundaries in handlers.
6. **Route UI and AI through the same application services.** Replace direct table mutations incrementally. HTTP routes and AI tools become thin adapters over commands and queries.
7. **Add a durable event outbox.** Publish events in the same transaction as state changes, then add idempotent workers for activity timelines, notifications, Brain Score, and cross-domain reactions.
8. **Consolidate database migrations.** Establish one ordered, reproducible migration history and generated database types. Treat corrective SQL files as migration inputs, not competing sources of truth.
9. **Resolve missing and duplicate contracts.** Add or reconcile the missing task API path, overlapping shift services, incident naming, environment-variable contract, duplicate route artifacts, and incomplete module shells through the new boundaries.
10. **Expand testing.** Add domain, authorization, tenancy, RLS, contract, event, AI-tool, integration, and end-to-end coverage in risk order.
11. **Add perception and integration foundations only after the core command/event architecture is stable.** Define normalized contracts and simulations before connecting production cameras, sensors, POS, PMS, or access systems.

Extraction into separate deployable services is not an early goal. A domain should leave the monolith only when independent scaling, security isolation, fault containment, data residency, team ownership, or edge deployment provides a demonstrated benefit. Contract boundaries must exist before physical distribution.

## 22. Definition of Done

A feature is not complete merely because its screen works or its endpoint returns success. Completion requires:

- Domain logic exists in the owning bounded context.
- Authorization and capability policies exist.
- Tenant and property isolation are verified.
- UI, API, AI, automation, and integration entry points use the same application path.
- Relevant domain events are emitted transactionally.
- Important reads, decisions, approvals, and mutations have appropriate audit records.
- Errors are typed and machine-readable.
- Tests exist at the appropriate domain, policy, contract, integration, and workflow levels.
- Logs, traces, metrics, correlation, and operational alerts exist in proportion to risk.
- Brain Score and automation integration have been explicitly considered and implemented where relevant.
- Data classification, retention, privacy, reliability, and failure behavior have been reviewed.
- Documentation and contracts are updated.

Exceptions must be explicit, time-bounded, owned, and recorded as architectural debt. Tenant isolation, authorization, auditability, and approval for high-impact actions are never deferrable exceptions.

## Enforcement

This manifesto is an architectural constitution, not an aspirational backlog. Architecture decisions should reference it. Pull requests and AI-generated changes must state the affected bounded context, entry paths, commands or queries, events, authorization policy, tenancy behavior, audit behavior, tests, and any deliberate exception.

When short-term delivery and permanent architecture conflict, prefer an incremental seam: preserve behavior, introduce the correct contract, place legacy behavior behind an adapter, and migrate consumers safely. Brain must advance continuously toward one governed, observable, event-connected Hospitality AI Operating System.
