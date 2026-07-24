# Phase B1 Production capture runbook

This runbook covers the read-only function-body and environment-bound definition
capture for Production project reference `jjhtasppfxunbrswgxht`.

Do not run the capture until Production execution is explicitly approved.

## Safety boundary

- Run only `B1_PRODUCTION_FUNCTION_AND_ENVIRONMENT_CAPTURE.sql`.
- Run it only in the Production Supabase SQL Editor after manually confirming the
  project reference.
- Do not contact Preview.
- Do not edit schemas, functions, policies, cron jobs, storage, or migration
  history.
- Do not paste unredacted cron commands, Vault values, credentials, tokens, or
  secrets into source control, chat, tickets, or evidence documents.

The query returns one row with one JSON value:
`b1_function_environment_evidence`.

## Expected validation

Before exporting, verify:

1. `capture_metadata.function_count_matches_b0` is `true`.
2. `capture_metadata.captured_application_function_count` is `70`.
3. `capture_metadata.cron_job_count_matches_b0` is `true`.
4. `capture_metadata.captured_cron_job_count` is `2`.
5. `capture_metadata.contains_unredacted_cron_literals` is `false`.
6. Every function row contains a definition SHA-256 value.
7. Review every row where `definition_redacted` is `true`; the original text must
   not be exported through another channel.
8. `project_ref_confirmation` is either `confirmed` or, if unavailable, the
   Production project selector was manually confirmed before execution.

Export the single result row using the SQL Editor result download. Treat the
export as restricted deployment evidence even though the query applies
conservative redaction.

## Offline cron provenance decision

For each of the two rows in `cron_repository_provenance_inputs`:

1. Use the row's `repository_source_file`.
2. Offline, extract the exact UTF-8 command argument supplied to
   `cron.schedule` without executing it.
3. Compute SHA-256 over those exact command bytes.
4. Compare only the digest with `production_command_sha256`.
5. Record `exact_repository_match` only when the digests are identical.
6. Otherwise record `not_an_exact_repository_match`; do not expose either
   unredacted command while investigating.

Whitespace and line endings are significant. A mismatch is not proof of
semantic drift; it means only that exact provenance has not been established.

This comparison is offline and must not query Production or Preview.
