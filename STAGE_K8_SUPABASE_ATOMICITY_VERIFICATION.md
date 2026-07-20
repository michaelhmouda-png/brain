# Stage K8 Supabase Atomicity Verification

Run this verification only against an isolated Supabase test project after applying migrations through
`202607210001_stage_k8_create_task_transactional_outbox.sql`. Do not run against production because it deliberately
forces transaction failures and creates disposable task/proposal records.

Use a server-side integration-test harness with the service role key. Never place that key in browser code, test
snapshots, logs, or committed environment files.

## Preconditions

1. Create disposable company, active auth user/profile, employee, and executing `create_task` proposal fixtures.
2. Record the fixture tenant, actor, profile, proposal, command, correlation, task, and event UUIDs.
3. Count matching rows in `tasks` and `brain_event_outbox` before each case.

## Successful transaction

Call `create_task_with_outbox_event` with a valid canonical task and matching `task.created` payload. Verify exactly
one task and one pending outbox row commit, with matching task/aggregate ID, tenant, actor, command, correlation,
causation, proposal, and idempotency values.

## Forced task insert failure

Call the RPC with a deliberately duplicated task primary key while using a fresh event ID and command identity.
Verify the RPC fails and that neither row was added: the task count and outbox count remain at their pre-call values.

## Forced outbox insert failure

Call the RPC with a fresh task ID but an already-used `(command_id, event_type)` or `(company_id, idempotency_key)`.
Verify the RPC fails and the fresh task ID does not exist. This proves the earlier task insert rolled back when the
outbox insert failed, leaving neither row from the attempted transaction.

## Authority failures

Repeat with actor/profile mismatch, inactive profile, different tenant, cross-tenant employee, non-executing proposal,
aggregate/task mismatch, event causation/command mismatch, and altered event payload. Each call must fail with no task
or outbox row committed.

## Delivery

Deliver the committed outbox event through the focused server delivery adapter. Verify one `brain_domain_events` row
and a delivered outbox state. Redeliver the identical record and verify no duplicate event. Force domain-event storage
failure and verify the outbox remains pending and the task count does not change.

Remove all disposable fixtures when verification is complete. Preserve only safe counts and pass/fail evidence.
