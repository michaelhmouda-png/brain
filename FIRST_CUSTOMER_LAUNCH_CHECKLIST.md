# First-customer pilot acceptance and launch checklist

Every row needs an owner, date, Preview evidence, Production result, and rollback/forward-recovery decision. Never attach secrets, raw database output, customer payloads, or camera images.

| Area | Acceptance | Blocking result |
|---|---|---|
| Release | Clean Release Gate passes on the exact revision; migration hashes and order valid | Any failed/skipped gate |
| Authentication | Owner, manager, employee sign in/reset; inactive account denied | Authority or session bypass |
| Tenant isolation | Separate test companies cannot read/write each other's employees, tasks, shifts, inventory, evidence, agents, or reservations | Any cross-tenant access |
| Provisioning | Super admin confirms once; all invitations are durably recorded; company/location/departments/employees/profiles appear atomically; retry is idempotent | Partial tenant database state or unverified invite binding |
| Workers | Four domain workers and operational evaluator reject browser requests; protected replay remains idempotent | Unauthorized execution or duplicate effects |
| Alerts | Failed/stale worker, stale/dead-letter queue, offline Agent, and recurring failure produce safe management alert codes; external health fails degraded | Missing or tenant-bearing alert |
| Backups | Recent provider backup confirmed and logical restore passes in disposable project | Unverified restore or Production write |
| Agent | Dedicated identity, DPAPI/ACL, reboot startup, process recovery, heartbeat, update and rollback pass | Plaintext credential, no recovery, or stale heartbeat |
| Tasks/routines | One-off and recurring tasks materialize, assign only from concrete shifts, retry without duplicates | Template-direct assignment or duplicate task |
| Shifts | Weekly schedule, day off, overnight, exception, future version, overlap and DST behavior pass | Wrong local time/overlap/history mutation |
| Evidence | Upload, queue, bounded AI verification, manager review, and failure retry pass | Evidence leakage or silent completion |
| Inventory | Tenant/location authorization, canonical movement, atomic balance, and replay protection pass | Direct browser/AI mutation or balance mismatch |
| Reservations | Create/edit/rebook/calendar stay tenant- and timezone-correct | Cross-location/timezone corruption |
| PWA/mobile/RTL | Install/update/offline shell, 375px dialogs, Arabic layout and inputs pass | Blocking mobile or RTL workflow |
| Recovery | Application rollback compatibility and database forward-repair owner confirmed | No recoverable path |

## Launch approval gates

- Production migration: database owner plus security reviewer; approved backup and forward-recovery plan.
- Security/configuration: two-person review of names/scopes only; Preview fail-closed evidence.
- Destructive action: exact target and recovery stated; separate explicit approval.
- External communication: customer owner approval before any real invitation or operational message.
- Paid service: business approval before monitoring, backup/PITR, email, or other billable activation.
- Launch: business owner, technical owner, incident commander, and customer contact approve the observation window and escalation contacts.

Critical alerts page the incident commander immediately. High alerts require acknowledgement within 15 minutes. Medium alerts are reviewed the same business day. If acknowledgement is unavailable, pause launch or customer-impacting changes.
