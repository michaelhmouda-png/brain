# Backup and restore-verification runbook

## Safety contract

The workflow is manual only and requires approval through the GitHub `backup-restore-verification` environment. Production is read-only. Restoration is allowed only into a separately referenced project explicitly marked disposable. The guard verifies that source, target, and Production references are valid and distinct and that each database URL is bound to its declared project without printing any URL.

Required GitHub environment configuration (names only):

- Variables: `BACKUP_SOURCE_PROJECT_REF`, `RESTORE_TARGET_PROJECT_REF`, `PRODUCTION_PROJECT_REF`, `RESTORE_TARGET_DISPOSABLE=true`.
- Secrets: `BACKUP_SOURCE_DATABASE_URL` for a read-only backup role and `RESTORE_TARGET_DATABASE_URL` for the disposable project.

Never use the service-role API key as a database password. Never configure the Production database URL as the restore target. Protect the GitHub environment with required reviewers and restrict secret access to this workflow.

## Verification

1. Obtain database and destructive-target approval. Confirm the restore target contains no data that must be retained.
2. Confirm automated provider backups/PITR are healthy separately; this workflow verifies logical restorability, not PITR retention.
3. Dispatch `Backup restore verification`. The workflow validates boundaries before installing tools or creating a dump.
4. It creates an ephemeral custom-format dump, restores with `--clean --if-exists` only into the disposable target, and verifies critical tables and the Worker Health RPC.
5. Record workflow run, source backup time, elapsed restoration time, migration head, and verification result. Do not copy database output or customer data into the record.
6. Delete or re-isolate the disposable project through an separately approved provider action. No cleanup is automated because deletion requires explicit approval.

## Failure recovery

- Boundary failure: correct reference/URL scope; never bypass the guard.
- Dump failure: verify read-only credential and provider connectivity. Production remains unchanged.
- Restore failure: quarantine the disposable target, preserve safe error codes, and retry only after cause review.
- Catalog verification failure: treat the backup as unverified and block launch. Investigate migration completeness and issue a forward repair if required.

Quarterly verification is the pilot minimum; also run before a material schema release or customer launch. Paid backup/PITR tier changes require separate approval.
