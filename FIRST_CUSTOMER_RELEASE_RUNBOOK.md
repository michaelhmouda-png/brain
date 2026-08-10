# First Customer Release Runbook — Stage 1A

This is the source of truth for Preview and Production releases. It does not authorize a deployment, database change, or external configuration change.

## Environment contract

Create variables independently in Vercel **Preview** and **Production**. Never copy a Preview database credential into Production or promote a build containing Preview `NEXT_PUBLIC_*` values into Production. `BRAIN_DEPLOYMENT_ENV` must match `VERCEL_ENV`; startup fails with a safe configuration code when it does not.

| Variable | Visibility | Purpose |
|---|---|---|
| `BRAIN_DEPLOYMENT_ENV` | server | Exact target: `preview` or `production` |
| `NEXT_PUBLIC_APP_URL` | public | HTTPS origin for the current target |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project base URL, without `/rest/v1` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Browser-safe Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | Trusted server RPC/storage access |
| `CRON_SECRET` | secret | Vercel Cron GET bearer authentication |
| `NOTIFICATION_WORKER_SECRET` | secret | Manual POST replay for notification and materialization workers |
| `TASK_EVIDENCE_WORKER_SECRET` | secret | Manual POST replay for evidence worker |
| `OPENAI_API_KEY` | secret | Brain, localization, and evidence provider access |
| `OPENAI_VISION_MODEL` | server | Approved evidence model name |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | public | Browser push subscription key |
| `VAPID_PRIVATE_KEY` | secret | Server push signing key |
| `VAPID_SUBJECT` | server | Push operator contact URI |
| `BRAIN_AGENT_TOKEN_PEPPER` | secret | Agent credential hashing |
| `BRAIN_AGENT_RATE_LIMIT_PEPPER` | secret | Agent rate-limit identity hashing |

Worker and pepper secrets must be independently generated and at least 32 characters. Values must never be placed in issues, logs, screenshots, runbooks, or CI. CI uses inert placeholders and no Production credentials.

Built-in/runtime-only names are `NODE_ENV`, `NEXT_RUNTIME`, `VERCEL`, `VERCEL_ENV`, and Windows `LOCALAPPDATA`; operators do not invent values for them. Development-only agent diagnostics use `BRAIN_AGENT_ALLOW_INSECURE_LOCALHOST`, `BRAIN_AGENT_ALLOW_DEVELOPMENT_RATE_ADDRESS`, and `BRAIN_AGENT_DEVELOPMENT_RATE_ADDRESS` and must remain unset in Preview/Production. The isolated concurrency runner uses `PREVIEW_SUPABASE_URL`, `PREVIEW_ANON_KEY`, `PREVIEW_SERVICE_ROLE_KEY`, `PREVIEW_OWNER_ACCESS_TOKEN`, and `PREVIEW_LOCATION_ID`; those are test-process inputs, never application or Production variables.

## Source-controlled schedules

`vercel.json` defines UTC schedules. Vercel Cron invokes route handlers with `GET` and `Authorization: Bearer <CRON_SECRET>`. Browser GET requests without that header receive 401. Existing manual replay remains a `POST` with its worker-specific bearer secret; cron authentication does not weaken it.

Vercel runs cron jobs only for Production deployments. Preview verifies the same source-controlled schedule contract and uses approved manual POST replays for end-to-end acceptance; it must not point at Production data.

| Worker | Schedule | Bounded operation |
|---|---|---|
| Notifications | Every minute | One outbox claim and one delivery claim, plus bounded localization and compatibility materialization |
| Recurring tasks | Every five minutes | Reminder batch 100; occurrence batch 10; 24-hour horizon |
| Weekly shifts | Hourly | Series batch 25; 42-day horizon |
| Evidence | Every minute | One evidence job; OpenAI is called only after a canonical job is claimed |
| Operational health | Every five minutes | Read-only evaluation of worker freshness, stale/dead-letter queues, offline agents, and recurring-task failures |

The notification worker retains its existing best-effort recurring materialization for compatibility; the dedicated schedules guarantee independent execution. Replays overlap safely because database leases, retry limits, unique constraints, deterministic provenance, and RPC idempotency remain authoritative. Do not add a second Supabase `pg_cron` schedule for these endpoints.

## Preview deployment

1. Obtain release approval; confirm no Production variables are in Preview.
2. Run `npm ci`, `npm run check:secrets`, `npm run check:migrations`, `npm run test:release`, `npm run test:all`, `npm run typecheck`, `npm run lint:changed`, `npm run build`, and `git diff --check`.
3. Review the forward migration and apply it only to the approved Preview database through the controlled migration path.
4. Deploy the exact reviewed revision to Preview.
5. Confirm startup succeeds and unauthenticated worker GET/POST requests return 401.
6. Confirm each scheduled worker records a success or a bounded safe failure in `/dashboard/operations/worker-health`.
7. Seed disposable queue work and verify replay creates no duplicate notification, task, shift, or evidence result.
8. Record acceptance evidence and the exact revision/migration versions.

## Production deployment

1. Require technical, security, database, and business approval.
2. Confirm backup/PITR health and identify recovery owner and change window.
3. Re-run the release gate against the exact revision accepted in Preview.
4. Apply forward migrations first. Do not edit or re-run applied migration files manually.
5. Deploy the same revision with Production-scoped variables.
6. Verify startup, authentication, health API authorization, worker heartbeats, queue age, and materialization freshness.
7. Observe at least two notification/evidence intervals and one recurring-task interval. Weekly shifts may be manually replayed with the protected POST after approval rather than waiting an hour.

## Failure recovery and manual replay

- A failed worker run records only a bounded safe failure code. Inspect server logs by correlation/time without copying secrets or payloads.
- Fix configuration/provider/database availability first. Retryable queue rows remain canonical and are reclaimed after their lease/backoff.
- An authorized operator may POST to the exact internal endpoint with the matching manual worker secret. Never replay from a browser console or expose the header to a customer.
- Repeated execution is expected and must remain idempotent. Do not manually edit queue, generated-task, generated-shift, or evidence rows.
- Dead-letter rows require incident review. Recovery must use an approved forward repair or existing domain retry contract, never ad-hoc Production SQL.

## Rollback and forward recovery

- Application rollback: redeploy the last known-good revision only if it is compatible with every already-applied migration.
- Database migrations are forward-only. Never roll back by deleting columns, tables, or migration history.
- If a migration has applied and application rollback is incompatible, keep or restore the compatible application and ship an approved forward repair.
- If worker behavior is unsafe, revoke/rotate its schedule secret or disable the Vercel schedule through an approved emergency change; preserve queued records for recovery.

## Approval gates

- Migration: reviewed SQL, security tests, Preview rehearsal, backup/PITR confirmation, forward-recovery plan.
- Security/environment: two-person review and Preview fail-closed verification.
- Deployment: all CI gates green on the exact revision; no automatic deployment from this workflow.
- Destructive action, paid service, Production access, or external communication: explicit separate approval.

## Stage 1B activation order

1. Pass the complete Release Gate and review `202608060001_first_customer_readiness_stage1b.sql` independently.
2. Apply the migration to an isolated Preview project only after database approval. Verify forced RLS and service-only grants.
3. Deploy Preview and test `/api/health`, protected operational-health replay, management Worker Health alerts, and one disposable customer onboarding. Use non-customer email addresses owned by the test team.
4. Rehearse [backup restoration](BACKUP_RESTORE_RUNBOOK.md) against a disposable non-Production Supabase project. Production is the read-only dump source only after separate approval.
5. Rehearse [Windows Agent installation and rollback](BRAIN_AGENT_WINDOWS_RUNBOOK.md) on a supported test host using a test venue/location.
6. Complete [the launch checklist](FIRST_CUSTOMER_LAUNCH_CHECKLIST.md), then request separate approvals for Production migration, deployment, monitoring configuration, invitation email delivery, and launch.

The public `/api/health` response exposes only `ok`/`degraded`, a stable code, and a check timestamp. Detailed counts, configuration variable names, and alert codes remain management-authorized. Server request instrumentation logs only stable error code, method, router kind, and operation type; it never logs paths, query strings, headers, bodies, tenant identifiers, or raw error messages.
