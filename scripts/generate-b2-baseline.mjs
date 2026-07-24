import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const workspace = process.cwd();
const b0Path = path.join(workspace, '.b0-capture', 'production-catalog-evidence.json');
const b1Path = path.join(
  workspace,
  '.b0-capture',
  '.b0-capture',
  'b1-function-environment-evidence.json',
);
const outputDir = path.join(workspace, 'b2-baseline');

const EXPECTED_B0_SHA256 =
  '51ace3fcb4cac1b84380ce83c89ad86847e13499feecd7c01017b38f154d86dc';
const EXPECTED_B1_SHA256 =
  'bb16865d4ba9b2695b3aae5feb0ae38a144873c98809884c63190a494b68b188';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJsonWithHash(filePath, expectedHash) {
  const bytes = fs.readFileSync(filePath);
  const actualHash = sha256(bytes);
  if (actualHash !== expectedHash) {
    throw new Error(
      `AUTHORITATIVE_EVIDENCE_HASH_MISMATCH ${filePath}: expected ${expectedHash}, got ${actualHash}`,
    );
  }
  return { document: JSON.parse(bytes.toString('utf8')), hash: actualHash };
}

function unwrap(document, key) {
  const outer = Array.isArray(document) ? document[0] : document;
  const value = outer?.[key];
  if (!value) throw new Error(`AUTHORITATIVE_EVIDENCE_ROOT_MISSING ${key}`);
  return value;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function qualified(schema, name) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function roleSql(role) {
  return role === 'PUBLIC' ? 'PUBLIC' : quoteIdentifier(role);
}

function sorted(values, selector) {
  return [...values].sort((left, right) =>
    selector(left).localeCompare(selector(right), 'en'),
  );
}

function functionKey(row) {
  return `${row.schema}.${row.name}(${row.identity_arguments ?? ''})`;
}

function b0FunctionKey(row) {
  return `${row.schema}.${row.name}(${row.identity_arguments ?? ''})`;
}

function restoreAndVerifyFunctions(b1) {
  const restorations = [];
  const definitions = b1.application_function_definitions.map((row) => {
    let definition = row.full_create_or_replace_definition;

    if (row.definition_redacted) {
      const key = functionKey(row);
      const expectedKey =
        'public.save_my_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_device text)';
      if (key !== expectedKey) {
        throw new Error(`UNAPPROVED_REDACTED_FUNCTION ${key}`);
      }

      const marker = '[REDACTED_URL_OR_CONNECTION_STRING]';
      if (!definition.includes(marker)) {
        throw new Error(`EXPECTED_REDACTION_MARKER_MISSING ${key}`);
      }

      // The B1 redactor consumed only the leading public endpoint-validation
      // fragment. This fragment is restored from the repository candidate and
      // accepted only because the complete server-rendered definition then
      // matches the authoritative B1 SHA-256 byte-for-byte.
      definition = definition.replace(marker, 'https://(fcm');
      restorations.push({
        function: key,
        method: 'repository_fragment_candidate_verified_against_authoritative_b1_sha256',
        definition_sha256: row.definition_sha256,
      });
    }

    const actualHash = sha256(Buffer.from(definition, 'utf8'));
    if (actualHash !== row.definition_sha256) {
      throw new Error(
        `FUNCTION_DEFINITION_HASH_MISMATCH ${functionKey(row)}: expected ${row.definition_sha256}, got ${actualHash}`,
      );
    }

    return { ...row, exact_definition: definition };
  });

  return { definitions, restorations };
}

function extractDollarQuotedBody(source, tag) {
  const delimiter = `$${tag}$`;
  const start = source.indexOf(delimiter);
  if (start < 0) throw new Error(`CRON_SOURCE_DELIMITER_MISSING ${delimiter}`);
  const bodyStart = start + delimiter.length;
  const end = source.indexOf(delimiter, bodyStart);
  if (end < 0) throw new Error(`CRON_SOURCE_DELIMITER_UNCLOSED ${delimiter}`);
  return source.slice(bodyStart, end);
}

function compareCronProvenance(b1) {
  const repositoryCandidates = new Map([
    [
      'camera-evidence-worker-every-minute',
      {
        file: 'supabase/migrations/202607210008_camera_evidence_worker_schedule.sql',
        tag: 'worker_request',
      },
    ],
    [
      'notification-worker-every-minute',
      {
        file: 'supabase/migrations/202607210009_notification_foundation_n1.sql',
        tag: 'cmd',
      },
    ],
  ]);

  return sorted(b1.cron_repository_provenance_inputs, (row) => row.jobname).map(
    (production) => {
      const candidate = repositoryCandidates.get(production.jobname);
      if (!candidate) throw new Error(`UNKNOWN_CRON_JOB ${production.jobname}`);
      if (candidate.file !== production.repository_source_file) {
        throw new Error(`CRON_REPOSITORY_SOURCE_MISMATCH ${production.jobname}`);
      }

      const source = fs.readFileSync(path.join(workspace, candidate.file), 'utf8');
      const command = extractDollarQuotedBody(source, candidate.tag);
      const repositoryHash = sha256(Buffer.from(command, 'utf8'));
      const repositoryBytes = Buffer.byteLength(command, 'utf8');

      return {
        jobname: production.jobname,
        repository_source_file: candidate.file,
        repository_command_sha256: repositoryHash,
        production_command_sha256: production.production_command_sha256,
        repository_utf8_bytes: repositoryBytes,
        production_utf8_bytes: production.command_utf8_bytes,
        exact_match: repositoryHash === production.production_command_sha256,
      };
    },
  );
}

function validateEvidence(b0, b1, functions) {
  const expectedCounts = {
    tables_and_views: 50,
    columns: 576,
    constraints: 352,
    indexes: 169,
    functions: 70,
    triggers: 20,
    row_level_security: 50,
    policies: 85,
  };

  for (const [section, expected] of Object.entries(expectedCounts)) {
    const source =
      section === 'functions'
        ? functions
        : section === 'tables_and_views'
          ? b0.tables_and_views.filter((row) => row.kind === 'table')
          : b0[section];
    if (source.length !== expected) {
      throw new Error(
        `AUTHORITATIVE_COUNT_MISMATCH ${section}: expected ${expected}, got ${source.length}`,
      );
    }
  }

  if (b0.storage_policies.length !== 2) {
    throw new Error('AUTHORITATIVE_COUNT_MISMATCH storage_policies');
  }
  if (b0.storage_bucket_configuration.length !== 1) {
    throw new Error('AUTHORITATIVE_COUNT_MISMATCH storage_bucket_configuration');
  }
  if (b1.capture_metadata.function_count_matches_b0 !== true) {
    throw new Error('B1_FUNCTION_COUNT_NOT_CONFIRMED');
  }

  const b0Functions = new Map(b0.functions.map((row) => [b0FunctionKey(row), row]));
  for (const row of functions) {
    const catalog = b0Functions.get(functionKey(row));
    if (!catalog) throw new Error(`B1_FUNCTION_NOT_IN_B0 ${functionKey(row)}`);
    if (catalog.owner !== row.owner) {
      throw new Error(`FUNCTION_OWNER_MISMATCH ${functionKey(row)}`);
    }
    if (catalog.security_definer !== row.security_definer) {
      throw new Error(`FUNCTION_SECURITY_MISMATCH ${functionKey(row)}`);
    }
    if (catalog.language !== row.language) {
      throw new Error(`FUNCTION_LANGUAGE_MISMATCH ${functionKey(row)}`);
    }
  }
}

function renderExtensions(b0) {
  const lines = ['-- Required captured extensions.'];
  for (const extension of sorted(b0.extensions, (row) => row.name)) {
    if (extension.name === 'plpgsql') {
      lines.push(
        `CREATE EXTENSION IF NOT EXISTS ${quoteIdentifier(extension.name)} VERSION ${sqlLiteral(extension.version)};`,
      );
      continue;
    }
    const schemaClause = extension.relocatable
      ? ` WITH SCHEMA ${quoteIdentifier(extension.schema)}`
      : '';
    lines.push(
      `CREATE EXTENSION IF NOT EXISTS ${quoteIdentifier(extension.name)}${schemaClause} VERSION ${sqlLiteral(extension.version)};`,
    );
  }
  return lines.join('\n');
}

function renderSchemas(b0) {
  const schemaByName = new Map(
    b0.application_schemas.map((row) => [row.schema, row]),
  );
  const privateSchema = schemaByName.get('private');
  const publicSchema = schemaByName.get('public');
  if (!privateSchema || !publicSchema) {
    throw new Error('EXPECTED_APPLICATION_SCHEMAS_MISSING');
  }

  return [
    '-- Required managed extension schemas and captured application schemas.',
    'CREATE SCHEMA IF NOT EXISTS "extensions";',
    'CREATE SCHEMA IF NOT EXISTS "vault";',
    `CREATE SCHEMA IF NOT EXISTS "private" AUTHORIZATION ${quoteIdentifier(privateSchema.owner)};`,
    `ALTER SCHEMA "private" OWNER TO ${quoteIdentifier(privateSchema.owner)};`,
    `ALTER SCHEMA "public" OWNER TO ${quoteIdentifier(publicSchema.owner)};`,
  ].join('\n');
}

function renderTables(b0) {
  const tableRows = sorted(
    b0.tables_and_views.filter((row) => row.kind === 'table'),
    (row) => `${row.schema}.${row.name}`,
  );

  return tableRows
    .map((table) => {
      const columns = sorted(
        b0.columns.filter(
          (column) =>
            column.schema === table.schema && column.relation === table.name,
        ),
        (column) => String(column.ordinal_position).padStart(5, '0'),
      );
      const columnSql = columns.map((column) => {
        const parts = [quoteIdentifier(column.column), column.type];
        if (column.identity === 'always') {
          parts.push('GENERATED ALWAYS AS IDENTITY');
        } else if (column.identity === 'by_default') {
          parts.push('GENERATED BY DEFAULT AS IDENTITY');
        } else if (column.generated === 'stored') {
          if (!column.default) {
            throw new Error(
              `GENERATED_COLUMN_EXPRESSION_MISSING ${table.schema}.${table.name}.${column.column}`,
            );
          }
          parts.push(`GENERATED ALWAYS AS (${column.default}) STORED`);
        } else if (column.default !== null && column.default !== undefined) {
          parts.push(`DEFAULT ${column.default}`);
        }
        if (!column.nullable) parts.push('NOT NULL');
        return `  ${parts.join(' ')}`;
      });

      return [
        `CREATE TABLE ${qualified(table.schema, table.name)} (`,
        columnSql.join(',\n'),
        ');',
        `ALTER TABLE ${qualified(table.schema, table.name)} OWNER TO ${quoteIdentifier(table.owner)};`,
      ].join('\n');
    })
    .join('\n\n');
}

function renderFunctions(functions) {
  return sorted(functions, functionKey)
    .map((row) => {
      const definition = row.exact_definition.trimEnd();
      const terminator = definition.endsWith(';') ? '' : ';';
      return [
        definition + terminator,
        `ALTER FUNCTION ${qualified(row.schema, row.name)}(${row.identity_arguments ?? ''}) OWNER TO ${quoteIdentifier(row.owner)};`,
      ].join('\n');
    })
    .join('\n\n');
}

function orderedConstraints(b0) {
  const typeOrder = new Map([
    ['primary_key', 0],
    ['unique', 1],
    ['check', 2],
    ['exclusion', 3],
    ['foreign_key', 4],
  ]);
  return [...b0.constraints].sort((left, right) => {
    const typeDiff =
      (typeOrder.get(left.type) ?? 99) - (typeOrder.get(right.type) ?? 99);
    if (typeDiff !== 0) return typeDiff;
    return `${left.schema}.${left.relation}.${left.name}`.localeCompare(
      `${right.schema}.${right.relation}.${right.name}`,
      'en',
    );
  });
}

function renderConstraints(constraints) {
  return constraints
    .map(
      (row) =>
        `ALTER TABLE ${qualified(row.schema, row.relation)} ADD CONSTRAINT ${quoteIdentifier(row.name)} ${row.definition};`,
    )
    .join('\n');
}

function rewriteIndexDefinition(index) {
  const match = index.definition.match(
    /^(CREATE\s+(?:UNIQUE\s+)?INDEX)\s+\S+\s+ON\s+\S+\s+([\s\S]+)$/i,
  );
  if (!match) throw new Error(`UNSUPPORTED_INDEX_DEFINITION ${index.index}`);
  return `${match[1]} ${quoteIdentifier(index.index)} ON ${qualified(index.schema, index.relation)} ${match[2]};`;
}

function normalizeKeyColumns(value) {
  return value
    .split(',')
    .map((column) => column.trim().replace(/^"|"$/g, ''))
    .join(',');
}

function foreignKeyReference(row) {
  const match = row.definition.match(
    /^FOREIGN KEY \([^)]+\) REFERENCES (?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*\(([^)]+)\)/,
  );
  if (!match) throw new Error(`UNSUPPORTED_FOREIGN_KEY_DEFINITION ${row.name}`);
  return {
    schema: row.referenced_schema,
    relation: row.referenced_relation,
    columns: normalizeKeyColumns(match[1]),
  };
}

function constraintKey(row) {
  const match = row.definition.match(
    /^(?:PRIMARY KEY|UNIQUE(?: NULLS NOT DISTINCT)?) \(([^)]+)\)/,
  );
  if (!match) throw new Error(`UNSUPPORTED_KEY_CONSTRAINT ${row.name}`);
  return {
    schema: row.schema,
    relation: row.relation,
    columns: normalizeKeyColumns(match[1]),
  };
}

function uniqueIndexKey(row) {
  if (!row.unique || row.predicate !== null) return null;
  const match = row.definition.match(/ USING [A-Za-z0-9_]+ \(([^)]+)\)(?: |$)/);
  if (!match) throw new Error(`UNSUPPORTED_UNIQUE_INDEX_KEY ${row.index}`);
  return {
    schema: row.schema,
    relation: row.relation,
    columns: normalizeKeyColumns(match[1]),
  };
}

function keySignature(row) {
  return `${row.schema}.${row.relation}(${row.columns})`;
}

function auditForeignKeyDependencies(b0) {
  const applicationSchemas = new Set(
    b0.application_schemas.map((row) => row.schema),
  );
  const constraintKeys = new Map();
  for (const row of b0.constraints.filter(
    (constraint) =>
      constraint.type === 'primary_key' || constraint.type === 'unique',
  )) {
    const signature = keySignature(constraintKey(row));
    const rows = constraintKeys.get(signature) ?? [];
    rows.push(row);
    constraintKeys.set(signature, rows);
  }

  const indexKeys = new Map();
  for (const row of b0.indexes) {
    const key = uniqueIndexKey(row);
    if (!key) continue;
    const signature = keySignature(key);
    const rows = indexKeys.get(signature) ?? [];
    rows.push(row);
    indexKeys.set(signature, rows);
  }

  const foreignKeys = b0.constraints.filter(
    (row) => row.type === 'foreign_key',
  );
  const requiredExplicitIndexes = new Set();
  const results = [];

  for (const foreignKey of foreignKeys) {
    const reference = foreignKeyReference(foreignKey);
    const signature = keySignature(reference);
    const supportingConstraints = constraintKeys.get(signature) ?? [];
    const supportingIndexes = indexKeys.get(signature) ?? [];
    const managedPrerequisite = !applicationSchemas.has(reference.schema);

    if (
      !managedPrerequisite &&
      supportingConstraints.length === 0 &&
      supportingIndexes.length === 0
    ) {
      throw new Error(
        `FOREIGN_KEY_KEY_PREREQUISITE_MISSING ${foreignKey.schema}.${foreignKey.relation}.${foreignKey.name} -> ${signature}`,
      );
    }

    if (
      !managedPrerequisite &&
      supportingConstraints.length === 0 &&
      supportingIndexes.length > 0
    ) {
      for (const index of supportingIndexes) {
        requiredExplicitIndexes.add(
          `${index.schema}.${index.relation}.${index.index}`,
        );
      }
    }

    results.push({
      foreign_key: `${foreignKey.schema}.${foreignKey.relation}.${foreignKey.name}`,
      referenced_key: signature,
      support:
        supportingConstraints.length > 0
          ? 'captured_constraint'
          : supportingIndexes.length > 0
            ? 'captured_unique_index'
            : 'managed_prerequisite',
    });
  }

  if (foreignKeys.length !== 133) {
    throw new Error(
      `FOREIGN_KEY_COUNT_MISMATCH expected=133 actual=${foreignKeys.length}`,
    );
  }

  return {
    foreignKeyCount: foreignKeys.length,
    capturedConstraintCount: results.filter(
      (row) => row.support === 'captured_constraint',
    ).length,
    capturedUniqueIndexCount: results.filter(
      (row) => row.support === 'captured_unique_index',
    ).length,
    managedPrerequisiteCount: results.filter(
      (row) => row.support === 'managed_prerequisite',
    ).length,
    requiredExplicitIndexes,
    results,
  };
}

function renderIndexes(b0, dependencyAudit) {
  const constraintIndexNames = new Set(
    b0.constraints
      .filter((row) => row.type === 'primary_key' || row.type === 'unique')
      .map((row) => `${row.schema}.${row.relation}.${row.name}`),
  );
  const explicitIndexes = sorted(
    b0.indexes.filter(
      (index) =>
        !constraintIndexNames.has(
          `${index.schema}.${index.relation}.${index.index}`,
        ),
    ),
    (row) => `${row.schema}.${row.relation}.${row.index}`,
  );
  const dependencyIndexes = explicitIndexes.filter((index) =>
    dependencyAudit.requiredExplicitIndexes.has(
      `${index.schema}.${index.relation}.${index.index}`,
    ),
  );
  const remainingIndexes = explicitIndexes.filter(
    (index) =>
      !dependencyAudit.requiredExplicitIndexes.has(
        `${index.schema}.${index.relation}.${index.index}`,
      ),
  );

  return {
    beforeForeignKeysSql: dependencyIndexes
      .map(rewriteIndexDefinition)
      .join('\n'),
    afterForeignKeysSql: remainingIndexes
      .map(rewriteIndexDefinition)
      .join('\n'),
    explicitCount: explicitIndexes.length,
    constraintBackedCount: b0.indexes.length - explicitIndexes.length,
    foreignKeyDependencyIndexCount: dependencyIndexes.length,
  };
}

function renderTriggers(b0) {
  return sorted(
    b0.triggers,
    (row) => `${row.schema}.${row.relation}.${row.trigger}`,
  )
    .map((row) => {
      const statements = [`${row.definition};`];
      if (row.enabled === 'disabled') {
        statements.push(
          `ALTER TABLE ${qualified(row.schema, row.relation)} DISABLE TRIGGER ${quoteIdentifier(row.trigger)};`,
        );
      } else if (row.enabled === 'replica') {
        statements.push(
          `ALTER TABLE ${qualified(row.schema, row.relation)} ENABLE REPLICA TRIGGER ${quoteIdentifier(row.trigger)};`,
        );
      } else if (row.enabled === 'always') {
        statements.push(
          `ALTER TABLE ${qualified(row.schema, row.relation)} ENABLE ALWAYS TRIGGER ${quoteIdentifier(row.trigger)};`,
        );
      }
      return statements.join('\n');
    })
    .join('\n');
}

function renderRls(b0) {
  return sorted(
    b0.row_level_security,
    (row) => `${row.schema}.${row.relation}`,
  )
    .flatMap((row) => [
      `ALTER TABLE ${qualified(row.schema, row.relation)} ${row.rls_enabled ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY;`,
      `ALTER TABLE ${qualified(row.schema, row.relation)} ${row.rls_forced ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY;`,
    ])
    .join('\n');
}

function renderPolicy(row, schema = row.schema, relation = row.relation) {
  const roles = row.roles.map(roleSql).join(', ');
  const parts = [
    `CREATE POLICY ${quoteIdentifier(row.policy)} ON ${qualified(schema, relation)}`,
    `AS ${row.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'}`,
    `FOR ${row.command}`,
    `TO ${roles}`,
  ];
  if (row.using !== null && row.using !== undefined) {
    parts.push(`USING (${row.using})`);
  }
  if (row.with_check !== null && row.with_check !== undefined) {
    parts.push(`WITH CHECK (${row.with_check})`);
  }
  return `${parts.join('\n  ')};`;
}

function renderPolicies(b0) {
  return sorted(
    b0.policies,
    (row) => `${row.schema}.${row.relation}.${row.policy}`,
  )
    .map((row) => renderPolicy(row))
    .join('\n\n');
}

function groupGrants(rows, keySelector) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keySelector(row);
    const existing = grouped.get(key) ?? { ...row, privileges: [] };
    existing.privileges.push(row.privilege);
    grouped.set(key, existing);
  }
  return [...grouped.values()].map((row) => ({
    ...row,
    privileges: [...new Set(row.privileges)].sort(),
  }));
}

function renderSchemaGrants(b0) {
  const lines = [];
  for (const schema of sorted(
    b0.application_schemas,
    (row) => row.schema,
  )) {
    const owner = schema.owner;
    const grantees = ['PUBLIC', 'anon', 'authenticated', 'service_role', 'postgres'];
    const revocable = grantees.filter((role) => role !== owner);
    lines.push(
      `REVOKE ALL PRIVILEGES ON SCHEMA ${quoteIdentifier(schema.schema)} FROM ${revocable.map(roleSql).join(', ')};`,
    );
  }

  const grants = groupGrants(
    b0.schema_grants.filter((row) => row.grantee !== row.owner),
    (row) => `${row.schema}|${row.grantee}|${row.grantable}`,
  );
  for (const row of sorted(
    grants,
    (grant) => `${grant.schema}.${grant.grantee}.${grant.grantable}`,
  )) {
    lines.push(
      `GRANT ${row.privileges.join(', ')} ON SCHEMA ${quoteIdentifier(row.schema)} TO ${roleSql(row.grantee)}${row.grantable ? ' WITH GRANT OPTION' : ''};`,
    );
  }
  return lines.join('\n');
}

function renderRelationGrants(b0) {
  const relationKinds = new Map();
  for (const relation of b0.table_and_sequence_grants) {
    relationKinds.set(
      `${relation.schema}.${relation.relation}`,
      relation.relation_kind,
    );
  }

  const lines = [];
  for (const [key, kind] of [...relationKinds.entries()].sort()) {
    const separator = key.indexOf('.');
    const schema = key.slice(0, separator);
    const relation = key.slice(separator + 1);
    const objectKind = kind === 'sequence' ? 'SEQUENCE' : 'TABLE';
    lines.push(
      `REVOKE ALL PRIVILEGES ON ${objectKind} ${qualified(schema, relation)} FROM PUBLIC, "anon", "authenticated", "service_role";`,
    );
  }

  const grants = groupGrants(
    b0.table_and_sequence_grants.filter((row) => row.grantee !== 'postgres'),
    (row) =>
      `${row.schema}|${row.relation}|${row.relation_kind}|${row.grantee}|${row.grantable}`,
  );
  for (const row of sorted(
    grants,
    (grant) =>
      `${grant.schema}.${grant.relation}.${grant.grantee}.${grant.grantable}`,
  )) {
    const objectKind =
      row.relation_kind === 'sequence' ? 'SEQUENCE' : 'TABLE';
    lines.push(
      `GRANT ${row.privileges.join(', ')} ON ${objectKind} ${qualified(row.schema, row.relation)} TO ${roleSql(row.grantee)}${row.grantable ? ' WITH GRANT OPTION' : ''};`,
    );
  }
  return lines.join('\n');
}

function renderRoutineGrants(b0, functions) {
  const ownerByKey = new Map(functions.map((row) => [functionKey(row), row.owner]));
  const lines = [];
  for (const row of sorted(functions, functionKey)) {
    lines.push(
      `REVOKE ALL PRIVILEGES ON FUNCTION ${qualified(row.schema, row.name)}(${row.identity_arguments ?? ''}) FROM PUBLIC, "anon", "authenticated", "service_role";`,
    );
  }

  const grants = groupGrants(
    b0.routine_grants.filter((row) => {
      const key = `${row.schema}.${row.routine}(${row.identity_arguments ?? ''})`;
      return row.grantee !== ownerByKey.get(key);
    }),
    (row) =>
      `${row.schema}|${row.routine}|${row.identity_arguments ?? ''}|${row.grantee}|${row.grantable}`,
  );
  for (const row of sorted(
    grants,
    (grant) =>
      `${grant.schema}.${grant.routine}(${grant.identity_arguments ?? ''}).${grant.grantee}`,
  )) {
    lines.push(
      `GRANT ${row.privileges.join(', ')} ON FUNCTION ${qualified(row.schema, row.routine)}(${row.identity_arguments ?? ''}) TO ${roleSql(row.grantee)}${row.grantable ? ' WITH GRANT OPTION' : ''};`,
    );
  }
  return lines.join('\n');
}

function renderStorage(b0) {
  const bucket = b0.storage_bucket_configuration[0];
  const mimeTypes = bucket.allowed_mime_types
    .map((value) => sqlLiteral(value))
    .join(', ');
  const bucketInsert = [
    'INSERT INTO storage.buckets',
    '  (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types, type)',
    'VALUES',
    `  (${sqlLiteral(bucket.id)}, ${sqlLiteral(bucket.name)}, ${bucket.public ? 'true' : 'false'}, ${bucket.avif_autodetection ? 'true' : 'false'}, ${bucket.file_size_limit}, ARRAY[${mimeTypes}]::text[], ${sqlLiteral(bucket.type)});`,
  ].join('\n');

  const policies = sorted(
    b0.storage_policies,
    (row) => `${row.relation}.${row.policy}`,
  )
    .map((row) => renderPolicy(row, 'storage', row.relation))
    .join('\n\n');

  return `${bucketInsert}\n\n${policies}`;
}

function stableSortObject(value) {
  if (Array.isArray(value)) return value.map(stableSortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableSortObject(value[key])]),
    );
  }
  return value;
}

function buildManifest({
  b0,
  b1,
  b0Hash,
  b1Hash,
  functions,
  restorations,
  cronProvenance,
  explicitIndexCount,
  constraintBackedIndexCount,
}) {
  const functionManifest = sorted(functions, functionKey).map((row) => ({
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

  return stableSortObject({
    manifest_version: 'B2-1',
    authoritative_inputs: {
      b0: {
        path: '.b0-capture/production-catalog-evidence.json',
        sha256: b0Hash,
        captured_at: b0.capture_metadata.captured_at,
      },
      b1: {
        path: '.b0-capture/.b0-capture/b1-function-environment-evidence.json',
        sha256: b1Hash,
        captured_at: b1.capture_metadata.captured_at,
      },
    },
    captured_counts: {
      application_schemas: b0.application_schemas.length,
      tables: b0.tables_and_views.filter((row) => row.kind === 'table').length,
      columns: b0.columns.length,
      constraints: b0.constraints.length,
      indexes_total: b0.indexes.length,
      indexes_created_explicitly: explicitIndexCount,
      indexes_created_by_constraints: constraintBackedIndexCount,
      functions: functions.length,
      triggers: b0.triggers.length,
      rls_relations: b0.row_level_security.length,
      application_policies: b0.policies.length,
      storage_policies: b0.storage_policies.length,
      extensions: b0.extensions.length,
    },
    application_schemas: sorted(
      b0.application_schemas,
      (row) => row.schema,
    ),
    tables: sorted(
      b0.tables_and_views.filter((row) => row.kind === 'table'),
      (row) => `${row.schema}.${row.name}`,
    ),
    columns: sorted(
      b0.columns,
      (row) =>
        `${row.schema}.${row.relation}.${String(row.ordinal_position).padStart(5, '0')}`,
    ),
    constraints: sorted(
      b0.constraints,
      (row) => `${row.schema}.${row.relation}.${row.name}`,
    ),
    indexes: sorted(
      b0.indexes,
      (row) => `${row.schema}.${row.relation}.${row.index}`,
    ),
    functions: functionManifest,
    function_definition_restorations: restorations,
    triggers: sorted(
      b0.triggers,
      (row) => `${row.schema}.${row.relation}.${row.trigger}`,
    ),
    row_level_security: sorted(
      b0.row_level_security,
      (row) => `${row.schema}.${row.relation}`,
    ),
    application_policies: sorted(
      b0.policies,
      (row) => `${row.schema}.${row.relation}.${row.policy}`,
    ),
    schema_grants: sorted(
      b0.schema_grants,
      (row) => `${row.schema}.${row.grantee}.${row.privilege}`,
    ),
    table_and_sequence_grants: sorted(
      b0.table_and_sequence_grants,
      (row) =>
        `${row.schema}.${row.relation}.${row.grantee}.${row.privilege}`,
    ),
    routine_grants: sorted(
      b0.routine_grants,
      (row) =>
        `${row.schema}.${row.routine}(${row.identity_arguments ?? ''}).${row.grantee}.${row.privilege}`,
    ),
    extensions: sorted(b0.extensions, (row) => row.name),
    storage_bucket_configuration: b0.storage_bucket_configuration,
    storage_policies: sorted(
      b0.storage_policies,
      (row) => `${row.relation}.${row.policy}`,
    ),
    cron_repository_provenance: cronProvenance,
    intentionally_absent_runtime_relations: [
      'brain_action_history',
      'brain_conversation_contexts',
      'business_events',
      'customer_interactions',
      'customers',
      'incidents',
      'inventory_items',
      'inventory_movements',
    ],
    exclusions: {
      cron_scheduling: 'environment_bound_and_not_in_core_baseline',
      migration_history: 'not_reconstructed_or_marked',
      business_rows: 'not_captured',
      auth_users: 'not_captured',
      storage_objects: 'not_captured',
      secrets_and_vault_values: 'not_captured',
    },
  });
}

function buildBaselineSql({
  b0,
  functions,
  b0Hash,
  b1Hash,
  indexRendering,
}) {
  const constraints = orderedConstraints(b0);
  const nonForeignKeyConstraints = constraints.filter(
    (row) => row.type !== 'foreign_key',
  );
  const foreignKeyConstraints = constraints.filter(
    (row) => row.type === 'foreign_key',
  );

  return `/*
 * Phase B2 current-state Production baseline.
 *
 * STAGED, NON-EXECUTABLE LOCATION: this file is intentionally outside
 * supabase/migrations until B3 validation and explicit adoption approval.
 *
 * Target: an empty fresh Supabase database only.
 * Never apply this object-creating baseline to the existing Production database.
 *
 * Authoritative B0 SHA-256: ${b0Hash}
 * Authoritative B1 SHA-256: ${b1Hash}
 *
 * Cron scheduling is intentionally excluded and documented separately.
 * Historical migration versions are not reconstructed or marked.
 */

BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL check_function_bodies = off;

${renderSchemas(b0)}

${renderExtensions(b0)}

-- Captured tables and columns. Constraints are added after all tables exist.
${renderTables(b0)}

-- Exact B1 server-rendered application function definitions.
${renderFunctions(functions)}

-- Captured primary, unique, check, and exclusion constraints.
${renderConstraints(nonForeignKeyConstraints)}

-- Captured standalone unique indexes required by foreign keys.
${indexRendering.beforeForeignKeysSql}

-- Captured foreign keys after every referenced primary/unique key exists.
${renderConstraints(foreignKeyConstraints)}

-- Remaining captured non-constraint indexes. Another
-- ${indexRendering.constraintBackedCount} indexes are created by the captured
-- primary/unique constraints above.
${indexRendering.afterForeignKeysSql}

-- Captured triggers and enabled states.
${renderTriggers(b0)}

-- Captured RLS enabled/forced state.
${renderRls(b0)}

-- Captured application policies.
${renderPolicies(b0)}

-- Captured effective schema privileges.
${renderSchemaGrants(b0)}

-- Captured effective table and sequence privileges.
${renderRelationGrants(b0)}

-- Captured effective routine privileges.
${renderRoutineGrants(b0, functions)}

-- Captured private task-evidence bucket and storage policies.
${renderStorage(b0)}

COMMIT;
`;
}

function buildCronRunbook(cronProvenance, b0Hash, b1Hash) {
  const rows = cronProvenance
    .map(
      (row) =>
        `| \`${row.jobname}\` | ${row.exact_match ? 'MATCH' : 'MISMATCH'} | \`${row.repository_command_sha256}\` | \`${row.production_command_sha256}\` | ${row.repository_utf8_bytes} / ${row.production_utf8_bytes} |`,
    )
    .join('\n');

  return `# B2 cron and environment-bound runbook

Cron scheduling is deliberately excluded from the core baseline.

- B0 SHA-256: \`${b0Hash}\`
- B1 SHA-256: \`${b1Hash}\`
- No command in this document contains an unredacted cron command, credential,
  token, URL, or Vault value.

## Offline exact-byte provenance

| Job | Result | Repository SHA-256 | Production SHA-256 | Repository/Production UTF-8 bytes |
|---|---|---|---|---:|
${rows}

The notification worker is an exact repository-byte match. The camera-evidence
worker is not an exact byte match. No semantic equivalence is inferred from its
redacted structure, and the repository command must not be silently substituted.

## Environment companion decision

No executable cron companion migration is generated in B2 because one of the
two Production commands lacks exact repository provenance.

Before creating a companion migration:

1. Resolve the camera-evidence mismatch through a separately approved,
   secret-safe provenance process.
2. Confirm required Vault entries exist without exporting their values.
3. Construct scheduling SQL from an approved source, never from redacted text.
4. Keep cron scheduling outside the core object baseline.
5. Validate job name, schedule, active state, exact command digest, and absence
   of duplicate jobs in B3 or a later approved environment phase.

Do not contact or modify Production or Preview as part of this runbook.
`;
}

function buildB3Plan(manifest, b0Hash, b1Hash) {
  const counts = manifest.captured_counts;
  return `# B3 validation plan

This plan is not authorization to execute SQL or contact any environment.

## Inputs

- B0 SHA-256: \`${b0Hash}\`
- B1 SHA-256: \`${b1Hash}\`
- Normalized B2 manifest generated from those exact bytes
- Staged B2 baseline outside \`supabase/migrations\`

## Static gate

1. Recompute both evidence hashes and fail on any change.
2. Regenerate B2 and require byte-identical outputs.
3. Parse every baseline statement without executing it.
4. Confirm the core baseline contains no cron scheduling, migration-history
   writes, business rows, auth users, storage objects, or absent runtime tables.
5. Confirm expected object counts:
   - ${counts.tables} tables
   - ${counts.columns} columns
   - ${counts.constraints} constraints
   - ${counts.indexes_total} total indexes
   - ${counts.functions} functions
   - ${counts.triggers} triggers
   - ${counts.application_policies} application policies
   - ${counts.storage_policies} storage policies

## Fresh-database gate

Only after explicit B3 approval:

1. Provision an empty disposable Supabase-compatible database that is neither
   Production nor Preview.
2. Verify managed prerequisites such as \`auth.users\`, \`storage.buckets\`,
   \`storage.objects\`, and captured extension availability.
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
`;
}

function buildUnresolvedReport({
  b0Hash,
  b1Hash,
  restorations,
  cronProvenance,
}) {
  const cronLines = cronProvenance
    .map(
      (row) =>
        `- \`${row.jobname}\`: ${row.exact_match ? 'exact repository-byte match' : 'exact repository-byte mismatch'} (${row.repository_utf8_bytes}/${row.production_utf8_bytes} repository/Production bytes).`,
    )
    .join('\n');

  return `# B2 unresolved differences

## Evidence integrity

- B0 SHA-256: \`${b0Hash}\`
- B1 SHA-256: \`${b1Hash}\`
- B1 contains 70 functions.
- One B1 definition was redacted by the URL detector. Only the consumed public
  endpoint-validation fragment was restored from the repository candidate, and
  the complete reconstructed definition matched authoritative B1 SHA-256
  \`${restorations[0]?.definition_sha256 ?? 'missing'}\`. This function-body gap
  is therefore resolved without substituting an unverified repository body.

## Cron provenance

${cronLines}

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
- Extension availability and managed \`auth\`/\`storage\` schemas are fresh
  Supabase database prerequisites.
- Business rows, auth users, storage objects, secrets, Vault values, and
  historical migration versions remain intentionally absent.

## Migration-chain state

The old executable migration chain has not been moved or modified. The B2
baseline is staged outside \`supabase/migrations\`, so archiving is not required
until a later squashing/adoption decision.

The eight runtime-referenced relations absent from Production are intentionally
not added.
`;
}

function writeGenerated(fileName, contents) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, fileName), contents, 'utf8');
}

const b0Input = readJsonWithHash(b0Path, EXPECTED_B0_SHA256);
const b1Input = readJsonWithHash(b1Path, EXPECTED_B1_SHA256);
const b0 = unwrap(b0Input.document, 'production_catalog_evidence');
const b1 = unwrap(b1Input.document, 'b1_function_environment_evidence');
const { definitions: functions, restorations } = restoreAndVerifyFunctions(b1);
validateEvidence(b0, b1, functions);
const cronProvenance = compareCronProvenance(b1);
const foreignKeyDependencyAudit = auditForeignKeyDependencies(b0);
const indexRendering = renderIndexes(b0, foreignKeyDependencyAudit);

const manifest = buildManifest({
  b0,
  b1,
  b0Hash: b0Input.hash,
  b1Hash: b1Input.hash,
  functions,
  restorations,
  cronProvenance,
  explicitIndexCount: indexRendering.explicitCount,
  constraintBackedIndexCount: indexRendering.constraintBackedCount,
});

writeGenerated(
  'B2_CURRENT_STATE_BASELINE.sql',
  buildBaselineSql({
    b0,
    functions,
    b0Hash: b0Input.hash,
    b1Hash: b1Input.hash,
    indexRendering,
  }),
);
writeGenerated(
  'B2_NORMALIZED_OBJECT_MANIFEST.json',
  `${JSON.stringify(manifest, null, 2)}\n`,
);
writeGenerated(
  'B2_CRON_ENVIRONMENT_RUNBOOK.md',
  buildCronRunbook(cronProvenance, b0Input.hash, b1Input.hash),
);
writeGenerated(
  'B2_B3_VALIDATION_PLAN.md',
  buildB3Plan(manifest, b0Input.hash, b1Input.hash),
);
writeGenerated(
  'B2_UNRESOLVED_DIFFERENCES.md',
  buildUnresolvedReport({
    b0Hash: b0Input.hash,
    b1Hash: b1Input.hash,
    restorations,
    cronProvenance,
  }),
);

const report = {
  status: 'generated',
  output_directory: path.relative(workspace, outputDir).replaceAll('\\', '/'),
  b0_sha256: b0Input.hash,
  b1_sha256: b1Input.hash,
  counts: manifest.captured_counts,
  foreign_key_dependency_audit: {
    foreign_keys: foreignKeyDependencyAudit.foreignKeyCount,
    supported_by_captured_constraints:
      foreignKeyDependencyAudit.capturedConstraintCount,
    supported_by_captured_unique_indexes:
      foreignKeyDependencyAudit.capturedUniqueIndexCount,
    supported_by_managed_prerequisites:
      foreignKeyDependencyAudit.managedPrerequisiteCount,
    unique_indexes_moved_before_foreign_keys:
      indexRendering.foreignKeyDependencyIndexCount,
  },
  function_restorations: restorations,
  cron_provenance: cronProvenance,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
