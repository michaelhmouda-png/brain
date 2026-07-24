# B2 unresolved differences

## Evidence integrity

- B0 SHA-256: `51ace3fcb4cac1b84380ce83c89ad86847e13499feecd7c01017b38f154d86dc`
- B1 SHA-256: `bb16865d4ba9b2695b3aae5feb0ae38a144873c98809884c63190a494b68b188`
- B1 contains 70 functions.
- One B1 definition was redacted by the URL detector. Only the consumed public
  endpoint-validation fragment was restored from the repository candidate, and
  the complete reconstructed definition matched authoritative B1 SHA-256
  `0fe210c6d69102b7199de3f33e6f3e8fb411bc92270bcb5a6d343f8a5f04393f`. This function-body gap
  is therefore resolved without substituting an unverified repository body.

## Cron provenance

- `camera-evidence-worker-every-minute`: exact repository-byte mismatch (456/469 repository/Production bytes).
- `notification-worker-every-minute`: exact repository-byte match (292/292 repository/Production bytes).

The camera mismatch remains unresolved. No camera cron command is emitted and
no semantic or whitespace-only equivalence is asserted.

## Catalog limitations carried forward

- The SQL session did not expose a safely derivable project reference; the
  expected Production reference remains metadata rather than SQL-confirmed.
- Captured ACLs describe effective privileges. The original sequence of GRANT,
  REVOKE, and default-privilege operations is unavailable and is not
  reconstructed.
- Managed Supabase platform configuration outside the captured PostgreSQL
  catalog is not part of the baseline.
- Extension availability and managed `auth`/`storage` schemas are fresh
  Supabase database prerequisites.
- Business rows, auth users, storage objects, secrets, Vault values, and
  historical migration versions remain intentionally absent.

## Migration-chain state

The old executable migration chain has not been moved or modified. The B2
baseline is staged outside `supabase/migrations`, so archiving is not required
until a later squashing/adoption decision.

The eight runtime-referenced relations absent from Production are intentionally
not added.
