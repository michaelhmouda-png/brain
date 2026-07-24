import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const workspace = process.cwd();
const baselinePath = path.join(
  workspace,
  'b2-baseline',
  'B2_CURRENT_STATE_BASELINE.sql',
);
const manifestPath = path.join(
  workspace,
  'b2-baseline',
  'B2_NORMALIZED_OBJECT_MANIFEST.json',
);
const b0Path = path.join(workspace, '.b0-capture', 'production-catalog-evidence.json');
const b1Path = path.join(
  workspace,
  '.b0-capture',
  '.b0-capture',
  'b1-function-environment-evidence.json',
);

const EXPECTED_B0 =
  '51ace3fcb4cac1b84380ce83c89ad86847e13499feecd7c01017b38f154d86dc';
const EXPECTED_B1 =
  'bb16865d4ba9b2695b3aae5feb0ae38a144873c98809884c63190a494b68b188';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function countMatches(source, expression) {
  return [...source.matchAll(expression)].length;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function qualified(schema, name) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

function normalizeKeyColumns(value) {
  return value
    .split(',')
    .map((column) => column.trim().replace(/^"|"$/g, ''))
    .join(',');
}

function keySignature(schema, relation, columns) {
  return `${schema}.${relation}(${normalizeKeyColumns(columns)})`;
}

function validateForeignKeyDependencyOrdering(manifest, baseline) {
  const applicationSchemas = new Set(
    manifest.application_schemas.map((row) => row.schema),
  );
  const constraintKeys = new Map();
  for (const row of manifest.constraints.filter(
    (constraint) =>
      constraint.type === 'primary_key' || constraint.type === 'unique',
  )) {
    const match = row.definition.match(
      /^(?:PRIMARY KEY|UNIQUE(?: NULLS NOT DISTINCT)?) \(([^)]+)\)/,
    );
    assert(match, `UNSUPPORTED_KEY_CONSTRAINT ${row.name}`);
    const signature = keySignature(row.schema, row.relation, match[1]);
    const rows = constraintKeys.get(signature) ?? [];
    rows.push(row);
    constraintKeys.set(signature, rows);
  }

  const uniqueIndexKeys = new Map();
  for (const row of manifest.indexes.filter(
    (index) => index.unique && index.predicate === null,
  )) {
    const match = row.definition.match(
      / USING [A-Za-z0-9_]+ \(([^)]+)\)(?: |$)/,
    );
    assert(match, `UNSUPPORTED_UNIQUE_INDEX_KEY ${row.index}`);
    const signature = keySignature(row.schema, row.relation, match[1]);
    const rows = uniqueIndexKeys.get(signature) ?? [];
    rows.push(row);
    uniqueIndexKeys.set(signature, rows);
  }

  const foreignKeys = manifest.constraints.filter(
    (row) => row.type === 'foreign_key',
  );
  assert(
    foreignKeys.length === 133,
    `FOREIGN_KEY_COUNT_MISMATCH expected=133 actual=${foreignKeys.length}`,
  );

  let capturedConstraintCount = 0;
  let capturedUniqueIndexCount = 0;
  let managedPrerequisiteCount = 0;

  for (const foreignKey of foreignKeys) {
    const match = foreignKey.definition.match(
      /^FOREIGN KEY \([^)]+\) REFERENCES (?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*\(([^)]+)\)/,
    );
    assert(match, `UNSUPPORTED_FOREIGN_KEY_DEFINITION ${foreignKey.name}`);
    const signature = keySignature(
      foreignKey.referenced_schema,
      foreignKey.referenced_relation,
      match[1],
    );
    const supportingConstraints = constraintKeys.get(signature) ?? [];
    const supportingIndexes = uniqueIndexKeys.get(signature) ?? [];
    const foreignKeySql =
      `ALTER TABLE ${qualified(foreignKey.schema, foreignKey.relation)}` +
      ` ADD CONSTRAINT ${quoteIdentifier(foreignKey.name)} ${foreignKey.definition};`;
    const foreignKeyPosition = baseline.indexOf(foreignKeySql);
    assert(
      foreignKeyPosition >= 0,
      `FOREIGN_KEY_SQL_MISSING ${foreignKey.schema}.${foreignKey.relation}.${foreignKey.name}`,
    );

    if (!applicationSchemas.has(foreignKey.referenced_schema)) {
      managedPrerequisiteCount += 1;
      continue;
    }

    assert(
      supportingConstraints.length > 0 || supportingIndexes.length > 0,
      `FOREIGN_KEY_KEY_PREREQUISITE_MISSING ${foreignKey.name} -> ${signature}`,
    );

    let prerequisiteExistsFirst = false;
    if (supportingConstraints.length > 0) {
      capturedConstraintCount += 1;
      prerequisiteExistsFirst = supportingConstraints.some((constraint) => {
        const sql =
          `ALTER TABLE ${qualified(constraint.schema, constraint.relation)}` +
          ` ADD CONSTRAINT ${quoteIdentifier(constraint.name)} ${constraint.definition};`;
        const position = baseline.indexOf(sql);
        return position >= 0 && position < foreignKeyPosition;
      });
    } else {
      capturedUniqueIndexCount += 1;
      prerequisiteExistsFirst = supportingIndexes.some((index) => {
        const sql =
          `CREATE UNIQUE INDEX ${quoteIdentifier(index.index)}` +
          ` ON ${qualified(index.schema, index.relation)} `;
        const position = baseline.indexOf(sql);
        return position >= 0 && position < foreignKeyPosition;
      });
    }

    assert(
      prerequisiteExistsFirst,
      `FOREIGN_KEY_PREREQUISITE_ORDER_INVALID ${foreignKey.schema}.${foreignKey.relation}.${foreignKey.name} -> ${signature}`,
    );
  }

  assert(
    capturedConstraintCount === 127,
    `FOREIGN_KEY_CONSTRAINT_SUPPORT_COUNT_MISMATCH ${capturedConstraintCount}`,
  );
  assert(
    capturedUniqueIndexCount === 1,
    `FOREIGN_KEY_INDEX_SUPPORT_COUNT_MISMATCH ${capturedUniqueIndexCount}`,
  );
  assert(
    managedPrerequisiteCount === 5,
    `FOREIGN_KEY_MANAGED_SUPPORT_COUNT_MISMATCH ${managedPrerequisiteCount}`,
  );

  const requiredIndexPosition = baseline.indexOf(
    'CREATE UNIQUE INDEX "employees_company_id_id_uidx" ON "public"."employees" ',
  );
  const dependentForeignKeyPosition = baseline.indexOf(
    'ADD CONSTRAINT "employee_migration_exceptions_employee_company_fkey"',
  );
  assert(requiredIndexPosition >= 0, 'EMPLOYEES_COMPOSITE_UNIQUE_INDEX_MISSING');
  assert(
    dependentForeignKeyPosition >= 0,
    'EMPLOYEE_MIGRATION_COMPOSITE_FOREIGN_KEY_MISSING',
  );
  assert(
    requiredIndexPosition < dependentForeignKeyPosition,
    'EMPLOYEES_COMPOSITE_UNIQUE_INDEX_ORDER_INVALID',
  );

  return {
    foreign_keys: foreignKeys.length,
    supported_by_captured_constraints: capturedConstraintCount,
    supported_by_captured_unique_indexes: capturedUniqueIndexCount,
    supported_by_managed_prerequisites: managedPrerequisiteCount,
  };
}

function validateLexicalBalance(source) {
  let state = 'normal';
  let dollarTag = null;
  let blockDepth = 0;
  let parentheses = 0;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (state === 'line_comment') {
      if (current === '\n') state = 'normal';
      continue;
    }
    if (state === 'block_comment') {
      if (current === '/' && next === '*') {
        blockDepth += 1;
        index += 1;
      } else if (current === '*' && next === '/') {
        blockDepth -= 1;
        index += 1;
        if (blockDepth === 0) state = 'normal';
      }
      continue;
    }
    if (state === 'single_quote') {
      if (current === "'" && next === "'") {
        index += 1;
      } else if (current === "'") {
        state = 'normal';
      }
      continue;
    }
    if (state === 'double_quote') {
      if (current === '"' && next === '"') {
        index += 1;
      } else if (current === '"') {
        state = 'normal';
      }
      continue;
    }
    if (state === 'dollar_quote') {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = null;
        state = 'normal';
      }
      continue;
    }

    if (current === '-' && next === '-') {
      state = 'line_comment';
      index += 1;
    } else if (current === '/' && next === '*') {
      state = 'block_comment';
      blockDepth = 1;
      index += 1;
    } else if (current === "'") {
      state = 'single_quote';
    } else if (current === '"') {
      state = 'double_quote';
    } else if (current === '$') {
      const match = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        state = 'dollar_quote';
        index += dollarTag.length - 1;
      }
    } else if (current === '(') {
      parentheses += 1;
    } else if (current === ')') {
      parentheses -= 1;
      assert(parentheses >= 0, `UNBALANCED_PARENTHESES at byte ${index}`);
    }
  }

  assert(state === 'normal', `UNCLOSED_SQL_LEXICAL_STATE ${state}`);
  assert(parentheses === 0, `UNBALANCED_PARENTHESES final=${parentheses}`);
}

const b0Bytes = fs.readFileSync(b0Path);
const b1Bytes = fs.readFileSync(b1Path);
assert(sha256(b0Bytes) === EXPECTED_B0, 'B0_HASH_MISMATCH');
assert(sha256(b1Bytes) === EXPECTED_B1, 'B1_HASH_MISMATCH');

const baseline = fs.readFileSync(baselinePath, 'utf8');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
validateLexicalBalance(baseline);
const foreignKeyDependencyAudit = validateForeignKeyDependencyOrdering(
  manifest,
  baseline,
);

const expected = {
  tables: 50,
  columns: 576,
  constraints: 352,
  indexes_total: 169,
  indexes_created_explicitly: 97,
  indexes_created_by_constraints: 72,
  functions: 70,
  triggers: 20,
  rls_relations: 50,
  application_policies: 85,
  storage_policies: 2,
  extensions: 7,
};
for (const [key, value] of Object.entries(expected)) {
  assert(
    manifest.captured_counts[key] === value,
    `MANIFEST_COUNT_MISMATCH ${key}`,
  );
}

const sqlCounts = {
  tables: countMatches(baseline, /^CREATE TABLE /gm),
  constraints: countMatches(
    baseline,
    /^ALTER TABLE .* ADD CONSTRAINT /gm,
  ),
  explicit_indexes: countMatches(
    baseline,
    /^CREATE (?:UNIQUE )?INDEX /gm,
  ),
  functions: countMatches(baseline, /^CREATE OR REPLACE FUNCTION /gm),
  triggers: countMatches(baseline, /^CREATE TRIGGER /gm),
  policies: countMatches(baseline, /^CREATE POLICY /gm),
  rls_enabled_state: countMatches(
    baseline,
    /^ALTER TABLE .* (?:ENABLE|DISABLE) ROW LEVEL SECURITY;$/gm,
  ),
  rls_forced_state: countMatches(
    baseline,
    /^ALTER TABLE .* (?:FORCE|NO FORCE) ROW LEVEL SECURITY;$/gm,
  ),
  extensions: countMatches(baseline, /^CREATE EXTENSION /gm),
  bucket_rows: countMatches(baseline, /^INSERT INTO storage\.buckets$/gm),
};

assert(sqlCounts.tables === 50, 'SQL_TABLE_COUNT_MISMATCH');
assert(sqlCounts.constraints === 352, 'SQL_CONSTRAINT_COUNT_MISMATCH');
assert(sqlCounts.explicit_indexes === 97, 'SQL_INDEX_COUNT_MISMATCH');
assert(sqlCounts.functions === 70, 'SQL_FUNCTION_COUNT_MISMATCH');
assert(sqlCounts.triggers === 20, 'SQL_TRIGGER_COUNT_MISMATCH');
assert(sqlCounts.policies === 87, 'SQL_POLICY_COUNT_MISMATCH');
assert(sqlCounts.rls_enabled_state === 50, 'SQL_RLS_ENABLED_COUNT_MISMATCH');
assert(sqlCounts.rls_forced_state === 50, 'SQL_RLS_FORCE_COUNT_MISMATCH');
assert(sqlCounts.extensions === 7, 'SQL_EXTENSION_COUNT_MISMATCH');
assert(sqlCounts.bucket_rows === 1, 'SQL_BUCKET_COUNT_MISMATCH');

assert(/^BEGIN;$/m.test(baseline), 'BASELINE_BEGIN_MISSING');
assert(/^COMMIT;$/m.test(baseline), 'BASELINE_COMMIT_MISSING');
assert(!/\bcron\.schedule\s*\(/i.test(baseline), 'CRON_SCHEDULING_IN_CORE');
assert(
  !/\bsupabase_migrations\.schema_migrations\b/i.test(baseline),
  'MIGRATION_HISTORY_REFERENCE_IN_CORE',
);
assert(
  !/\b(?:migration repair|db push|migration up|db reset)\b/i.test(baseline),
  'DEPLOYMENT_COMMAND_IN_CORE',
);

for (const relation of manifest.intentionally_absent_runtime_relations) {
  const escaped = relation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert(
    !new RegExp(`^CREATE TABLE [^\\n]*"${escaped}"`, 'm').test(baseline),
    `INTENTIONALLY_ABSENT_RELATION_CREATED ${relation}`,
  );
}

for (const functionRow of manifest.functions) {
  assert(
    /^[0-9a-f]{64}$/.test(functionRow.definition_sha256),
    `INVALID_FUNCTION_HASH ${functionRow.schema}.${functionRow.name}`,
  );
}

assert(
  !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(baseline),
  'PRIVATE_KEY_MATERIAL_FOUND',
);
assert(
  !/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(
    baseline,
  ),
  'JWT_LIKE_VALUE_FOUND',
);

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'static_validation_passed',
      b0_sha256: EXPECTED_B0,
      b1_sha256: EXPECTED_B1,
      baseline_sha256: sha256(Buffer.from(baseline, 'utf8')),
      manifest_sha256: sha256(fs.readFileSync(manifestPath)),
      sql_counts: sqlCounts,
      total_indexes:
        sqlCounts.explicit_indexes +
        manifest.captured_counts.indexes_created_by_constraints,
      foreign_key_dependency_audit: foreignKeyDependencyAudit,
      cron_scheduling_in_core: false,
      sql_executed: false,
    },
    null,
    2,
  )}\n`,
);
