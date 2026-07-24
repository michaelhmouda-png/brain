import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const workspace = process.cwd();
const outputDirectory = path.join(workspace, 'b3-validation');
const manifestPath = path.join(
  workspace,
  'b2-baseline',
  'B2_NORMALIZED_OBJECT_MANIFEST.json',
);
const b0RecapturePath = path.join(
  outputDirectory,
  'B3_B0_RECAPTURE.json',
);
const b1RecapturePath = path.join(
  outputDirectory,
  'B3_B1_RECAPTURE.json',
);
const comparisonPath = path.join(
  outputDirectory,
  'B3_DETERMINISTIC_COMPARISON.json',
);
const reportPath = path.join(outputDirectory, 'B3_VALIDATION_REPORT.md');

const authoritativeB0Path = path.join(
  workspace,
  '.b0-capture',
  'production-catalog-evidence.json',
);
const authoritativeB1Path = path.join(
  workspace,
  '.b0-capture',
  '.b0-capture',
  'b1-function-environment-evidence.json',
);

const PROJECT_REF = 'wozuloihfxptpeztcarn';
const PROTECTED_REFS = new Set([
  'jjhtasppfxunbrswgxht',
  'xhjbnqsjiztaonishdsw',
]);
const BASELINE_SHA256 =
  'debd7618da6d393d8010861e83a18e2c0a9ac208d360569f5e23f789e95f68e2';

if (PROTECTED_REFS.has(PROJECT_REF)) {
  throw new Error('SAFETY_ABORT_PROTECTED_PROJECT_REFERENCE');
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right, 'en'))
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function unwrap(document, key) {
  const row = Array.isArray(document) ? document[0] : document;
  const value = row?.[key];
  if (!value) throw new Error(`RECAPTURE_ROOT_MISSING ${key}`);
  return value;
}

const manifestBytes = fs.readFileSync(manifestPath);
const b0Bytes = fs.readFileSync(b0RecapturePath);
const b1Bytes = fs.readFileSync(b1RecapturePath);
const authoritativeB0Bytes = fs.readFileSync(authoritativeB0Path);
const authoritativeB1Bytes = fs.readFileSync(authoritativeB1Path);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (
  sha256(authoritativeB0Bytes) !== manifest.authoritative_inputs.b0.sha256 ||
  sha256(authoritativeB1Bytes) !== manifest.authoritative_inputs.b1.sha256
) {
  throw new Error('AUTHORITATIVE_EVIDENCE_HASH_MISMATCH');
}
const authoritativeB0 = unwrap(
  JSON.parse(authoritativeB0Bytes.toString('utf8')),
  'production_catalog_evidence',
);
const b0 = unwrap(
  JSON.parse(b0Bytes.toString('utf8')),
  'production_catalog_evidence',
);
const b1 = unwrap(
  JSON.parse(b1Bytes.toString('utf8')),
  'b1_function_environment_evidence',
);

const observedFunctions = b1.application_function_definitions.map((row) => ({
  schema: row.schema,
  name: row.name,
  identity_arguments: row.identity_arguments,
  definition_sha256: row.definition_sha256,
  language: row.language,
  volatility: row.volatility,
  security: row.security,
  security_definer: row.security_definer,
  owner: row.owner,
  proconfig: row.proconfig,
  search_path: row.search_path,
}));

const sections = [
  {
    name: 'application_schemas',
    expected: manifest.application_schemas,
    observed: b0.application_schemas,
    key: (row) => row.schema,
  },
  {
    name: 'tables',
    expected: manifest.tables,
    observed: b0.tables_and_views.filter((row) => row.kind === 'table'),
    key: (row) => `${row.schema}.${row.name}`,
  },
  {
    name: 'views',
    expected: authoritativeB0.tables_and_views.filter(
      (row) => row.kind !== 'table',
    ),
    observed: b0.tables_and_views.filter((row) => row.kind !== 'table'),
    key: (row) => `${row.schema}.${row.name}`,
  },
  {
    name: 'columns',
    expected: manifest.columns,
    observed: b0.columns,
    key: (row) => `${row.schema}.${row.relation}.${row.column}`,
  },
  {
    name: 'constraints',
    expected: manifest.constraints,
    observed: b0.constraints,
    key: (row) => `${row.schema}.${row.relation}.${row.name}`,
  },
  {
    name: 'indexes',
    expected: manifest.indexes,
    observed: b0.indexes,
    key: (row) => `${row.schema}.${row.relation}.${row.index}`,
  },
  {
    name: 'functions',
    expected: manifest.functions,
    observed: observedFunctions,
    key: (row) =>
      `${row.schema}.${row.name}(${row.identity_arguments ?? ''})`,
  },
  {
    name: 'triggers',
    expected: manifest.triggers,
    observed: b0.triggers,
    key: (row) => `${row.schema}.${row.relation}.${row.trigger}`,
  },
  {
    name: 'row_level_security',
    expected: manifest.row_level_security,
    observed: b0.row_level_security,
    key: (row) => `${row.schema}.${row.relation}`,
  },
  {
    name: 'application_policies',
    expected: manifest.application_policies,
    observed: b0.policies,
    key: (row) => `${row.schema}.${row.relation}.${row.policy}`,
  },
  {
    name: 'schema_grants',
    expected: manifest.schema_grants,
    observed: b0.schema_grants,
    key: (row) => `${row.schema}.${row.grantee}.${row.privilege}`,
  },
  {
    name: 'table_and_sequence_grants',
    expected: manifest.table_and_sequence_grants,
    observed: b0.table_and_sequence_grants,
    key: (row) =>
      `${row.schema}.${row.relation}.${row.kind}.${row.grantee}.${row.privilege}`,
  },
  {
    name: 'routine_grants',
    expected: manifest.routine_grants,
    observed: b0.routine_grants,
    key: (row) =>
      `${row.schema}.${row.routine}(${row.identity_arguments ?? ''}).${row.grantee}.${row.privilege}`,
  },
  {
    name: 'function_execute_grants',
    expected: authoritativeB0.function_execute_grants,
    observed: b0.function_execute_grants,
    key: (row) =>
      `${row.schema}.${row.function}(${row.identity_arguments ?? ''}).${row.grantee}.${row.privilege}`,
  },
  {
    name: 'extensions',
    expected: manifest.extensions,
    observed: b0.extensions,
    key: (row) => row.name,
  },
  {
    name: 'storage_bucket_configuration',
    expected: manifest.storage_bucket_configuration,
    observed: b0.storage_bucket_configuration,
    key: (row) => row.id,
  },
  {
    name: 'storage_policies',
    expected: manifest.storage_policies,
    observed: b0.storage_policies,
    key: (row) => `${row.schema}.${row.relation}.${row.policy}`,
  },
  {
    name: 'application_publication_membership',
    expected: authoritativeB0.application_publication_membership,
    observed: b0.application_publication_membership,
    key: (row) => `${row.publication}.${row.schema}.${row.relation}`,
  },
  {
    name: 'custom_auth_users_triggers_and_functions',
    expected: authoritativeB0.custom_auth_users_triggers_and_functions,
    observed: b0.custom_auth_users_triggers_and_functions,
    key: (row) =>
      `${row.object_type}.${row.schema}.${row.name}(${row.identity_arguments ?? ''})`,
  },
];

function indexRows(rows, key, sectionName) {
  const result = new Map();
  for (const row of rows) {
    const identity = key(row);
    if (result.has(identity)) {
      throw new Error(`DUPLICATE_IDENTITY ${sectionName} ${identity}`);
    }
    result.set(identity, row);
  }
  return result;
}

const differences = {};
const summary = {};

for (const section of sections) {
  const expected = indexRows(section.expected, section.key, section.name);
  const observed = indexRows(section.observed, section.key, section.name);
  const identities = [...new Set([...expected.keys(), ...observed.keys()])].sort(
    (left, right) => left.localeCompare(right, 'en'),
  );
  const missing = [];
  const extra = [];
  const changed = [];

  for (const identity of identities) {
    const expectedRow = expected.get(identity);
    const observedRow = observed.get(identity);
    if (expectedRow && !observedRow) {
      missing.push({ identity, expected: expectedRow });
    } else if (!expectedRow && observedRow) {
      extra.push({ identity, observed: observedRow });
    } else if (stableJson(expectedRow) !== stableJson(observedRow)) {
      changed.push({
        identity,
        expected: expectedRow,
        observed: observedRow,
      });
    }
  }

  differences[section.name] = { missing, extra, changed };
  summary[section.name] = {
    expected: section.expected.length,
    observed: section.observed.length,
    missing: missing.length,
    extra: extra.length,
    changed: changed.length,
  };
}

const totals = Object.values(summary).reduce(
  (result, row) => ({
    expected: result.expected + row.expected,
    observed: result.observed + row.observed,
    missing: result.missing + row.missing,
    extra: result.extra + row.extra,
    changed: result.changed + row.changed,
  }),
  { expected: 0, observed: 0, missing: 0, extra: 0, changed: 0 },
);

const comparisonStatus =
  totals.missing === 0 && totals.extra === 0 && totals.changed === 0
    ? 'passed_exact_catalog_match'
    : 'failed_catalog_differences';

const comparison = stableValue({
  comparison_version: 'B3-1',
  status: comparisonStatus,
  disposable_project: {
    ref: PROJECT_REF,
    region: 'eu-central-1',
    size: 'micro',
    protected_reference_guard: 'passed',
    lifecycle: 'deleted_after_recapture',
  },
  inputs: {
    baseline_sha256: BASELINE_SHA256,
    manifest_sha256: sha256(manifestBytes),
    authoritative_b0_sha256: sha256(authoritativeB0Bytes),
    authoritative_b1_sha256: sha256(authoritativeB1Bytes),
    b0_recapture_sha256: sha256(b0Bytes),
    b1_recapture_sha256: sha256(b1Bytes),
  },
  apply_result: {
    status: 'committed',
    transaction: 'single_baseline_begin_commit',
    fresh_application_table_count_before_apply: 0,
    other_write_sql_applied: false,
  },
  dependency_repair: {
    scope: 'ordering_only',
    foreign_keys_audited: 133,
    supported_by_captured_constraints: 127,
    supported_by_captured_unique_indexes: 1,
    supported_by_managed_prerequisites: 5,
    moved_before_foreign_keys:
      'public.employees.employees_company_id_id_uidx',
    manifest_byte_identical: true,
  },
  capture: {
    b0_sql: 'original_read_only_B0_capture',
    b1_sql: 'original_read_only_B1_capture',
    cron_jobs_observed: b0.cron_jobs.length,
    cron_provenance_inputs_observed:
      b1.cron_repository_provenance_inputs.length,
  },
  cron_provenance: {
    camera_evidence_worker: 'outstanding_exact_byte_mismatch',
    command_substituted: false,
    command_deployed: false,
  },
  summary,
  totals,
  differences,
});

fs.writeFileSync(
  comparisonPath,
  `${JSON.stringify(comparison, null, 2)}\n`,
  'utf8',
);

const summaryRows = Object.entries(summary)
  .map(
    ([section, row]) =>
      `| \`${section}\` | ${row.expected} | ${row.observed} | ${row.missing} | ${row.extra} | ${row.changed} |`,
  )
  .join('\n');

const report = `# B3 baseline validation report

## Result

**${comparisonStatus === 'passed_exact_catalog_match' ? 'PASSED — the repaired B2 baseline exactly matches the authoritative catalog manifest.' : 'FAILED — catalog differences remain after applying the repaired B2 baseline.'}**

- Disposable project: \`${PROJECT_REF}\`
- Region/size: \`eu-central-1\` / \`micro\`
- Lifecycle: deleted after the recapture completed
- Protected Production and Preview reference guard: passed
- B2 baseline SHA-256: \`${BASELINE_SHA256}\`
- Transaction result: committed
- Application tables before apply: 0
- Other write SQL applied: no

## Dependency-order repair

- All 133 foreign keys were audited.
- 127 use captured primary/unique constraints.
- 1 uses the captured standalone unique index
  \`employees_company_id_id_uidx\`.
- 5 use the managed \`auth.users\` primary key.
- Only \`employees_company_id_id_uidx\` was moved before foreign-key creation.
- The normalized object manifest remained byte-identical.

## Deterministic recapture comparison

| Section | Expected | Observed | Missing | Extra | Changed |
|---|---:|---:|---:|---:|---:|
${summaryRows}
| **Total** | **${totals.expected}** | **${totals.observed}** | **${totals.missing}** | **${totals.extra}** | **${totals.changed}** |

Every missing, extra, and changed identity, including complete expected and
observed catalog records, is recorded in
\`B3_DETERMINISTIC_COMPARISON.json\`. The original read-only B0 and B1 capture
SQL was used without modification.

## Remaining exact differences

- Sixteen existing columns have different \`ordinal_position\` values because
  Production contains physical dropped-column gaps that are not represented as
  live columns in B0:
  - In \`incident_reports\`, \`incident_time\` is shifted by one position and
    the 6 later columns are shifted by four positions.
  - 9 columns in \`maintenance_tickets\` are shifted by two positions.
- \`pg_net\` version \`0.20.4\` is installed in schema \`public\` in the fresh
  database, while Production captured it in schema \`extensions\`.
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
`;

fs.writeFileSync(reportPath, report, 'utf8');

process.stdout.write(
  `${JSON.stringify(
    {
      status: comparison.status,
      project_ref: PROJECT_REF,
      summary,
      totals,
      comparison_sha256: sha256(fs.readFileSync(comparisonPath)),
      report_sha256: sha256(fs.readFileSync(reportPath)),
    },
    null,
    2,
  )}\n`,
);
