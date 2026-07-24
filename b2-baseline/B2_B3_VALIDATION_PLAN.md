# B3 validation plan

This plan is not authorization to execute SQL or contact any environment.

## Inputs

- B0 SHA-256: `51ace3fcb4cac1b84380ce83c89ad86847e13499feecd7c01017b38f154d86dc`
- B1 SHA-256: `bb16865d4ba9b2695b3aae5feb0ae38a144873c98809884c63190a494b68b188`
- Normalized B2 manifest generated from those exact bytes
- Staged B2 baseline outside `supabase/migrations`

## Static gate

1. Recompute both evidence hashes and fail on any change.
2. Regenerate B2 and require byte-identical outputs.
3. Parse every baseline statement without executing it.
4. Confirm the core baseline contains no cron scheduling, migration-history
   writes, business rows, auth users, storage objects, or absent runtime tables.
5. Confirm expected object counts:
   - 50 tables
   - 576 columns
   - 352 constraints
   - 169 total indexes
   - 70 functions
   - 20 triggers
   - 85 application policies
   - 2 storage policies

## Fresh-database gate

Only after explicit B3 approval:

1. Provision an empty disposable Supabase-compatible database that is neither
   Production nor Preview.
2. Verify managed prerequisites such as `auth.users`, `storage.buckets`,
   `storage.objects`, and captured extension availability.
3. Apply only the staged baseline.
4. Run no application data seed.
5. Recapture B0- and B1-shaped evidence from the disposable database.

## Exact comparison gate

Compare normalized recapture against the B2 manifest:

1. Schemas, owners, tables, columns, defaults, identities, and nullability.
2. Constraint definitions and validation/deferrability state.
3. All indexes, uniqueness, validity, readiness, and predicates.
4. All function definition SHA-256 values, owners, language, volatility,
   security mode, and proconfig/search_path.
5. Trigger definitions and enabled state.
6. RLS enabled/forced state and every policy expression/role/command.
7. Effective schema, relation, sequence, and routine privileges.
8. Extension names, versions, and schemas.
9. Bucket configuration and storage policies.
10. Confirm all eight intentionally absent runtime relations remain absent.

Cron is validated separately and must not be scheduled while the camera command
provenance result remains a mismatch.

## Adoption gate

Do not move the baseline into the executable migration chain, archive existing
migrations, mark a baseline version, or contact Production until the fresh
database recapture is exact and a separate adoption approval is granted.
