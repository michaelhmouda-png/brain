# Validated baseline freeze

The Phase B2 current-state baseline is accepted and frozen as of 2026-07-24.

- Baseline SHA-256:
  `debd7618da6d393d8010861e83a18e2c0a9ac208d360569f5e23f789e95f68e2`
- Normalized manifest SHA-256:
  `d314eba9cc454048aa635049502710e46df0dc3478b74a6ea17a31c1695990cb`
- B3 deterministic comparison SHA-256:
  `fc2008b35e44e1251df4f37388443b0176366ecc45bdf1ae5ebdd08fe7a0ead3`
- Adopted first migration:
  `supabase/migrations/202607240000_current_state_baseline.sql`

The adopted migration is an exact byte copy of the validated baseline. Its
original staged-location header is intentionally retained so the validated
SHA-256 remains unchanged; this freeze record supersedes that header's staging
status.

## Accepted exceptions

The following are accepted environmental or physical-layout differences and
are not baseline defects:

1. Historical dropped-column physical ordinal gaps in `incident_reports` and
   `maintenance_tickets`. Do not recreate dropped columns merely to reproduce
   physical `attnum` gaps.
2. Managed `pg_net` extension schema placement. Do not force `pg_net` from the
   fresh project's managed `public` placement into another schema.

The machine-readable record is `B2_ACCEPTED_BASELINE_EXCEPTIONS.json`.

## Freeze rules

- Do not edit or regenerate the adopted baseline migration.
- Add future database changes as migrations after
  `202607240000_current_state_baseline.sql`.
- Do not reconstruct or mark historical Production migration versions.
- Keep cron scheduling outside the core baseline.
- The camera-evidence cron command mismatch remains unresolved; do not
  substitute or schedule that command without separate provenance approval.
- Do not apply this baseline to Production or the existing Preview project.

The prior 26-file executable migration chain is preserved byte-for-byte under
`supabase/migration_audit/pre_baseline_20260724/`.
