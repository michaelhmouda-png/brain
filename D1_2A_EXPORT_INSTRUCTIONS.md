# D1.2A Read-Only Export Instructions

## Purpose

These instructions allow an authorized operator to collect D1.2A metadata and aggregate evidence from the confirmed Brain development Supabase project without giving Codex a database password, service-role key, or unrestricted credential.

The companion file is [D1_2A_READ_ONLY_EXPORT_QUERIES.sql](./D1_2A_READ_ONLY_EXPORT_QUERIES.sql).

## Safety properties

The companion file contains only:

- SQL comments
- `SELECT` statements
- `WITH ... SELECT` statements

It contains no mutation, DDL, procedural block, RPC invocation, or program execution command. It does not select employee names, IDs, email addresses, phone numbers, salary values, notes, document contents, or auth metadata values.

Some catalog results necessarily include structural identifiers such as table, column, constraint, policy, role, and function names. These are required architecture metadata, not employee personal data.

## Before running anything

1. Sign in to the Supabase Dashboard yourself. Do not send Codex your password, API key, access token, or connection string.
2. Open project `jjhtasppfxunbrswgxht`.
3. Confirm the project name and reference in the dashboard header before every session.
4. Open **SQL Editor** and create a new unsaved query.
5. Open the companion SQL file locally in the IDE.
6. Do not paste or run the whole file at once. Copy one numbered query at a time, including its section comment.
7. Before pressing **Run**, visually confirm that the selection starts with `SELECT` or `WITH` and contains no statement after its terminating semicolon.
8. Never use a query editor tab containing migration, seed, repair, or application SQL for this audit.

## Recommended execution order

### Step 1: Structural inventory

Run these queries one at a time:

- 1.1 Relevant schemas
- 1.2 Relevant tables and views
- 2.1 Columns and types
- 3.1 Primary, unique, check, and exclusion constraints
- 3.2 Foreign keys and referential actions
- 4.1 Indexes
- 5.1 Triggers

Export each result as CSV if the dashboard offers CSV export. Suggested filenames:

```text
d1_2a_01_schemas.csv
d1_2a_02_objects.csv
d1_2a_03_columns.csv
d1_2a_04_constraints.csv
d1_2a_05_foreign_keys.csv
d1_2a_06_indexes.csv
d1_2a_07_triggers.csv
```

These results should contain structural metadata only.

### Step 2: RLS, grants, and ownership

Run:

- 6.1 RLS enabled/forced state
- 6.2 RLS policy definitions
- 7.1 Table and view grants

Suggested filenames:

```text
d1_2a_08_rls_state.csv
d1_2a_09_rls_policies.csv
d1_2a_10_table_grants.csv
```

Policy expressions may contain application role names and structural column references. Review the output before sharing and redact any unexpected literal secret or personal identifier. Ordinary policy definitions should not contain either.

### Step 3: Functions and RPCs

Run:

- 8.1 Relevant function signatures and security attributes
- 8.2 Function grants
- 8.3 Catalog-recorded function dependencies

Suggested filenames:

```text
d1_2a_11_functions.csv
d1_2a_12_function_grants.csv
d1_2a_13_function_dependencies.csv
```

The queries intentionally exclude complete function bodies. They collect signatures, security-definer/invoker state, function configuration, configured search path, grants, and catalog dependencies.

### Step 4: Migration history

Run 9.1 first. It shows the live migration-history columns.

Then run 9.2. It exports only applied migration version identifiers and deliberately excludes stored SQL statements.

Suggested filenames:

```text
d1_2a_14_migration_columns.csv
d1_2a_15_migration_versions.csv
```

If 9.2 returns a permissions error or missing-relation error, copy only the error code and sanitized message. Do not change grants or create a replacement table.

### Step 5: Safe auth and profile aggregates

Run:

- 10.1 `auth.users` structural metadata
- 10.2 Auth/profile aggregate totals
- 11.7 Profile authorization-role vocabulary
- 11.8 Profile status vocabulary
- 12.1 Profile-to-employee linkage integrity
- 12.2 Duplicate profile links

Suggested filenames:

```text
d1_2a_16_auth_structure.csv
d1_2a_17_auth_profile_totals.csv
d1_2a_18_profile_roles.csv
d1_2a_19_profile_statuses.csv
d1_2a_20_profile_link_integrity.csv
d1_2a_21_duplicate_profile_links.csv
```

Do not expand these queries with auth IDs, emails, phone numbers, provider metadata, timestamps, or user metadata.

### Step 6: Employee aggregate quality

Run:

- 11.1 Employee counts and missing-field counts
- 11.2 Counts by redacted tenant bucket
- 11.3 Status vocabulary
- 11.4 Employment-type vocabulary
- 11.5 Legacy role vocabulary
- 11.6 Duplicate-name aggregate summary

Suggested filenames:

```text
d1_2a_22_employee_quality.csv
d1_2a_23_employee_tenant_buckets.csv
d1_2a_24_employee_statuses.csv
d1_2a_25_employment_types.csv
d1_2a_26_legacy_roles.csv
d1_2a_27_duplicate_name_summary.csv
```

The legacy role vocabulary can contain human-entered job titles. Review it before sharing. If any value appears to contain a person's name or other personal information, replace that value with `[redacted-unexpected-free-text]` while preserving its count.

### Step 7: Tenant integrity

Run:

- 13.1 Employee parent references
- 13.2 Department manager and location integrity
- 13.3 Duplicate department-name summary
- 13.4 Duplicate location-name summary
- 14.1 Shift integrity
- 14.2 Attendance integrity
- 14.3 Time-off integrity
- 14.4 Shift-swap integrity
- 14.5 Task-assignee integrity

Suggested filenames should continue sequentially from `d1_2a_28_...`.

Before running each query, compare its referenced columns with the output from Query 2.1. If a live column name differs, do not improvise or edit the audit query. Record the query number and sanitized PostgreSQL error instead so Codex can update the documentation safely.

### Step 8: Deletion and undocumented-object inventory

Run:

- 15.1 Employee foreign-key deletion dependencies
- 15.2 Known employee reference counts
- 16.1 Candidate workforce/scheduling objects

These queries do not delete anything. Query 15.1 reads constraint metadata and planner row estimates; Query 15.2 returns aggregate reference counts.

## Handling missing tables or columns

The development database may differ from repository assumptions. A query against a missing table or column will fail without changing data.

When that happens:

1. Do not create the missing object.
2. Do not alter the query in the SQL Editor.
3. Record the query number.
4. Copy the PostgreSQL error code and sanitized error message.
5. Remove any identifier that unexpectedly looks personal.
6. Continue with the next independent query.

## Exporting results safely

For each result:

1. Prefer the SQL Editor's CSV download for multi-row metadata.
2. Use plain-text copy for single-row aggregate results.
3. Open the exported file locally before sharing it.
4. Confirm it contains no employee IDs, profile IDs, company IDs, names, emails, phone numbers, salary values, notes, document contents, auth metadata, API keys, tokens, or connection strings.
5. Keep structural table/column/policy/function names intact.
6. Redact any unexpected personal value as `[redacted]`, preserving aggregate counts.
7. Place all sanitized exports in a dedicated local folder such as:

```text
D1_2A_EXPORT_RESULTS/
```

Do not commit that results folder unless it has been reviewed and explicitly approved as documentation-safe.

## Providing results to Codex

Attach the sanitized CSV files or paste the result tables into the conversation. Include:

- The query number
- Whether it succeeded
- Export filename
- Any sanitized PostgreSQL error code/message
- Confirmation that the output was reviewed for personal data and secrets

Do not provide dashboard screenshots if they show project credentials, user identities, or unrelated database rows.

## Final safety checklist

- [ ] Correct project reference confirmed
- [ ] One query selected at a time
- [ ] Selection begins with `SELECT` or `WITH`
- [ ] No query was modified to write data
- [ ] No RPC was called
- [ ] No migration, seed, reset, or repair was run
- [ ] Every export was reviewed for personal data
- [ ] Secrets and personal identifiers were not copied
- [ ] Errors were sanitized
- [ ] Results were not committed without approval

Running these exports does not authorize D1.2B, D1.3, K9, migrations, remediation, or application changes.
