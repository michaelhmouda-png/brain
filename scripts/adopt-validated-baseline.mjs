import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const workspace = process.cwd();
const migrationsDirectory = path.join(workspace, 'supabase', 'migrations');
const archiveDirectory = path.join(
  workspace,
  'supabase',
  'migration_audit',
  'pre_baseline_20260724',
);
const baselineSource = path.join(
  workspace,
  'b2-baseline',
  'B2_CURRENT_STATE_BASELINE.sql',
);
const baselineTarget = path.join(
  migrationsDirectory,
  '202607240000_current_state_baseline.sql',
);

const EXPECTED_BASELINE_SHA256 =
  'debd7618da6d393d8010861e83a18e2c0a9ac208d360569f5e23f789e95f68e2';
const EXPECTED_MANIFEST_SHA256 =
  'd314eba9cc454048aa635049502710e46df0dc3478b74a6ea17a31c1695990cb';

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function relative(filePath) {
  return path.relative(workspace, filePath).replaceAll('\\', '/');
}

if (sha256(baselineSource) !== EXPECTED_BASELINE_SHA256) {
  throw new Error('VALIDATED_BASELINE_HASH_MISMATCH');
}
if (
  sha256(
    path.join(
      workspace,
      'b2-baseline',
      'B2_NORMALIZED_OBJECT_MANIFEST.json',
    ),
  ) !== EXPECTED_MANIFEST_SHA256
) {
  throw new Error('VALIDATED_MANIFEST_HASH_MISMATCH');
}
if (fs.existsSync(baselineTarget)) {
  throw new Error('BASELINE_TARGET_ALREADY_EXISTS');
}
if (fs.existsSync(archiveDirectory)) {
  throw new Error('MIGRATION_ARCHIVE_ALREADY_EXISTS');
}

const migrationFiles = fs
  .readdirSync(migrationsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => path.join(migrationsDirectory, entry.name))
  .sort((left, right) => left.localeCompare(right, 'en'));

if (migrationFiles.length !== 26) {
  throw new Error(
    `UNEXPECTED_EXECUTABLE_MIGRATION_COUNT expected=26 actual=${migrationFiles.length}`,
  );
}

const dirtyState = execFileSync(
  'git',
  ['status', '--porcelain=v1', '--', 'supabase/migrations'],
  { cwd: workspace, encoding: 'utf8' },
)
  .trimEnd()
  .split(/\r?\n/)
  .filter(Boolean);

const archivedFiles = migrationFiles.map((source) => ({
  original_path: relative(source),
  archived_path: relative(path.join(archiveDirectory, path.basename(source))),
  bytes: fs.statSync(source).size,
  sha256: sha256(source),
}));

fs.mkdirSync(archiveDirectory, { recursive: true });
for (const file of archivedFiles) {
  fs.renameSync(
    path.join(workspace, file.original_path),
    path.join(workspace, file.archived_path),
  );
}

fs.copyFileSync(baselineSource, baselineTarget);
if (sha256(baselineTarget) !== EXPECTED_BASELINE_SHA256) {
  throw new Error('ADOPTED_BASELINE_COPY_HASH_MISMATCH');
}

const archiveManifest = {
  manifest_version: 'migration-chain-archive-1',
  archived_on: '2026-07-24',
  reason:
    'Validated current-state baseline adopted as the beginning of a new migration chain.',
  original_executable_migration_count: archivedFiles.length,
  original_dirty_state: dirtyState,
  archived_files: archivedFiles,
  new_chain: {
    first_migration: relative(baselineTarget),
    sha256: EXPECTED_BASELINE_SHA256,
    normalized_object_manifest_sha256: EXPECTED_MANIFEST_SHA256,
  },
};

fs.writeFileSync(
  path.join(archiveDirectory, 'ARCHIVE_MANIFEST.json'),
  `${JSON.stringify(archiveManifest, null, 2)}\n`,
  'utf8',
);

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'validated_baseline_adopted',
      archived_migrations: archivedFiles.length,
      archive_directory: relative(archiveDirectory),
      first_migration: relative(baselineTarget),
      baseline_sha256: EXPECTED_BASELINE_SHA256,
      preserved_dirty_entries: dirtyState.length,
    },
    null,
    2,
  )}\n`,
);
