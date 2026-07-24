# B3 baseline validation report

## Result

**FAILED — catalog differences remain after applying the repaired B2 baseline.**

- Disposable project: `wozuloihfxptpeztcarn`
- Region/size: `eu-central-1` / `micro`
- Lifecycle: deleted after the recapture completed
- Protected Production and Preview reference guard: passed
- B2 baseline SHA-256: `debd7618da6d393d8010861e83a18e2c0a9ac208d360569f5e23f789e95f68e2`
- Transaction result: committed
- Application tables before apply: 0
- Other write SQL applied: no

## Dependency-order repair

- All 133 foreign keys were audited.
- 127 use captured primary/unique constraints.
- 1 uses the captured standalone unique index
  `employees_company_id_id_uidx`.
- 5 use the managed `auth.users` primary key.
- Only `employees_company_id_id_uidx` was moved before foreign-key creation.
- The normalized object manifest remained byte-identical.

## Deterministic recapture comparison

| Section | Expected | Observed | Missing | Extra | Changed |
|---|---:|---:|---:|---:|---:|
| `application_schemas` | 2 | 2 | 0 | 0 | 0 |
| `tables` | 50 | 50 | 0 | 0 | 0 |
| `views` | 0 | 0 | 0 | 0 | 0 |
| `columns` | 576 | 576 | 0 | 0 | 16 |
| `constraints` | 352 | 352 | 0 | 0 | 0 |
| `indexes` | 169 | 169 | 0 | 0 | 0 |
| `functions` | 70 | 70 | 0 | 0 | 0 |
| `triggers` | 20 | 20 | 0 | 0 | 0 |
| `row_level_security` | 50 | 50 | 0 | 0 | 0 |
| `application_policies` | 85 | 85 | 0 | 0 | 0 |
| `schema_grants` | 10 | 10 | 0 | 0 | 0 |
| `table_and_sequence_grants` | 1062 | 1062 | 0 | 0 | 0 |
| `routine_grants` | 162 | 162 | 0 | 0 | 0 |
| `function_execute_grants` | 162 | 162 | 0 | 0 | 0 |
| `extensions` | 7 | 7 | 0 | 0 | 1 |
| `storage_bucket_configuration` | 1 | 1 | 0 | 0 | 0 |
| `storage_policies` | 2 | 2 | 0 | 0 | 0 |
| `application_publication_membership` | 0 | 0 | 0 | 0 | 0 |
| `custom_auth_users_triggers_and_functions` | 0 | 0 | 0 | 0 | 0 |
| **Total** | **2780** | **2780** | **0** | **0** | **17** |

Every missing, extra, and changed identity, including complete expected and
observed catalog records, is recorded in
`B3_DETERMINISTIC_COMPARISON.json`. The original read-only B0 and B1 capture
SQL was used without modification.

## Remaining exact differences

- Sixteen existing columns have different `ordinal_position` values because
  Production contains physical dropped-column gaps that are not represented as
  live columns in B0:
  - In `incident_reports`, `incident_time` is shifted by one position and
    the 6 later columns are shifted by four positions.
  - 9 columns in `maintenance_tickets` are shifted by two positions.
- `pg_net` version `0.20.4` is installed in schema `public` in the fresh
  database, while Production captured it in schema `extensions`.
- No objects are missing or extra; all other compared records are exact.

These differences are outside the approved dependency-order-only repair and
were not remediated during this run.

## Cron provenance

The camera-evidence cron exact-byte mismatch remains outstanding. No command
was substituted, scheduled, or deployed. Cron scheduling remains excluded from
the baseline and comparison.

## Safety

- Production was never queried or modified.
- The existing Preview project was never queried or modified.
- No migration runner, seed, migration-history operation, or feature code was
  used.
- The only write SQL was the SHA-256-verified repaired B2 baseline against the
  disposable project.
- The disposable project and its temporary encrypted credential material were
  deleted after the evidence was saved.
